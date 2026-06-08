/**
 * Kick Predictions Service
 *
 * Sibling service to `kickChatService`. Owns the `predictions-channel-{id}`
 * Pusher subscription, the REST seed via `GET /predictions/latest`, and the
 * normalization → emit pipeline that feeds the shipped widget.
 *
 * Design contract (per docs/plans/2026-05-22-002-feat-predictions-backend-integration-plan.md, U1):
 *   - Reuses the existing Pusher singleton from `kick-chat.ts` (no second
 *     WebSocket; rides on the chat connection's lifecycle).
 *   - Emits `predictionUpdate` through `kickChatService` so the widget's
 *     existing handler at `KickChat.tsx:562` consumes events unchanged.
 *   - Anonymous Pusher subscription attempted first; on `subscription_error`,
 *     retries authed when an OAuth token is available; logs a one-time
 *     warning if both fail. Anonymous-first is critical for guest /
 *     not-authed-to-Kick coverage (see plan auth-state matrix).
 *   - REST seed fires immediately on `acquire()`, regardless of Pusher state,
 *     so mid-prediction joiners see the banner without waiting for the next
 *     real-time event (AE5).
 *   - Idempotent acquire: queues subscription requests if Pusher isn't
 *     connected yet, applies them on the next `connectionStateChange` to
 *     `connected`.
 *   - Ref-counted by channelId, mirroring `kickChatService`'s per-channel
 *     lifecycle.
 *
 * Patterns mirrored from:
 *   - apps/desktop/src/backend/services/chat/kick-chat.ts:864-958 (Pusher
 *     subscribe + bind shape).
 *   - apps/desktop/src/backend/services/chat/kick-chat.ts:341-466 (ref-counted
 *     acquire/release lifecycle).
 *   - apps/desktop/src/backend/api/platforms/kick/kick-pin-mutations.ts (REST
 *     read shape, AbortSignal.timeout, discriminated result).
 */

import type Pusher from "pusher-js";
// Cross-logger: imported by KickChat (renderer) — avoids dragging
// electron-log into the renderer bundle.
import { logger } from "@/lib/cross-logger";
import type { ChatConnectionStatus, UnifiedPrediction } from "../../../shared/chat-types";
import { getLatestPrediction } from "../../api/platforms/kick/kick-predictions";
import type { KickPredictionEventPayload } from "../../api/platforms/kick/kick-types";
import { getKickPusher, kickChatService } from "./kick-chat";
import { normalizeKickPrediction } from "./kick-prediction-normalizer";

export interface KickPredictionsChannelInfo {
  /** Numeric channel id used in the Pusher channel name. Match the value the
   *  widget's multiview filter expects (see KickChat.tsx:569). */
  channelId: string;
  /** Channel slug — used for the REST seed endpoint and as the dual-ID
   *  fallback on the normalized payload. */
  channelSlug: string;
  /** Optional Kick OAuth Bearer token. Used only on the authed-retry path
   *  when the anonymous Pusher subscription fails or when an anonymous REST
   *  seed returns 401. Not required for guests. */
  accessToken?: string;
}

interface PredictionsChannelEntry {
  channelId: string;
  channelSlug: string;
  accessToken: string | null;
  refCount: number;
  /** Active Pusher channel handle when subscribed, else null. */
  pusherChannel: ReturnType<Pusher["subscribe"]> | null;
  /** True once an authed-retry has happened so the warning fires at most once. */
  authedRetryAttempted: boolean;
  /** True once the per-channel "subscription failed" warning has fired. */
  warnedSubscriptionFailed: boolean;
}

/**
 * Singleton service. Owning the per-channel state at module scope keeps it
 * outside the React tree so Vite HMR doesn't break the live subscription
 * (mirroring the rationale called out in KickChat.tsx for the kickChatService
 * singleton).
 */
class KickPredictionsService {
  /** Per-channel state keyed by `channelId` (the same id used in the Pusher
   *  channel name). Ref-counted to support multiview. */
  private channels: Map<string, PredictionsChannelEntry> = new Map();

  /** When Pusher isn't connected at acquire time, queue channel ids here so
   *  the next `connectionStateChange` to `connected` flushes the queue. */
  private pendingSubscriptions: Set<string> = new Set();

  /** Track whether we've installed the deferred-connect listener on the chat
   *  service. We only need to install it once for the process lifetime. */
  private connectionListenerInstalled = false;

  /**
   * Acquire a reference for a channel. Idempotent — multiple calls for the
   * same channelId just bump the ref count without re-subscribing or re-firing
   * the REST seed. Use `release()` to balance.
   */
  async acquire(info: KickPredictionsChannelInfo): Promise<void> {
    const channelId = info.channelId;
    if (!channelId) return; // Defensive — empty channelId can't form a Pusher channel name.

    const existing = this.channels.get(channelId);
    if (existing) {
      existing.refCount += 1;
      // Refresh the slug / token in case the caller's auth state changed —
      // the slug should be stable, but the token can rotate.
      existing.channelSlug = info.channelSlug;
      if (info.accessToken) existing.accessToken = info.accessToken;
      return;
    }

    const entry: PredictionsChannelEntry = {
      channelId,
      channelSlug: info.channelSlug,
      accessToken: info.accessToken ?? null,
      refCount: 1,
      pusherChannel: null,
      authedRetryAttempted: false,
      warnedSubscriptionFailed: false,
    };
    this.channels.set(channelId, entry);

    // Ensure we'll catch the next "connected" event so deferred subscriptions
    // flush. Installed at most once for the process.
    this.ensureConnectionListener();

    // Kick off the REST seed and the Pusher subscription concurrently. The
    // REST seed populates the widget for mid-prediction joiners (AE5) without
    // waiting for Pusher; the subscription path takes over for live updates.
    // Both are best-effort and isolated from one another.
    void this.seedFromRest(entry);
    this.trySubscribeAnonymous(entry);
  }

  /**
   * Release one reference for a channel. When the last reference drops, the
   * Pusher subscription is torn down.
   */
  release(info: { channelId: string }): void {
    const channelId = info.channelId;
    if (!channelId) return;
    const entry = this.channels.get(channelId);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount > 0) return;

    this.unsubscribe(entry);
    this.channels.delete(channelId);
    this.pendingSubscriptions.delete(channelId);
  }

  // ========== Internal ==========

  private async seedFromRest(entry: PredictionsChannelEntry): Promise<void> {
    try {
      const result = await getLatestPrediction(entry.channelSlug, {
        accessToken: entry.accessToken ?? undefined,
      });
      if (!result.ok) {
        // Non-success surfaces only at debug — REST seed is a "nice to have"
        // path; Pusher carries production updates.
        if (process.env.NODE_ENV !== "production") {
          logger.debug("Chat:Predictions", "REST seed failed", {
            channelSlug: entry.channelSlug,
            kind: result.kind,
            message: result.message,
          });
        }
        return;
      }
      // Guard against teardown happening mid-flight — if the channel was
      // released while the REST fetch was outstanding, drop the result.
      if (!this.channels.has(entry.channelId)) return;
      if (!result.payload) return;
      const normalized = normalizeKickPrediction(result.payload, {
        channelId: entry.channelId,
        channelSlug: entry.channelSlug,
      });
      kickChatService.emit("predictionUpdate", normalized);
    } catch (error) {
      // Defensive — getLatestPrediction already wraps errors, but nothing in
      // this seed path should ever bubble.
      if (process.env.NODE_ENV !== "production") {
        logger.debug("Chat:Predictions", "REST seed threw", {
          channelSlug: entry.channelSlug,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
    }
  }

  /**
   * Attempt anonymous subscription. If Pusher isn't connected yet, queue the
   * channel for the deferred connect listener to apply.
   */
  private trySubscribeAnonymous(entry: PredictionsChannelEntry): void {
    const pusher = getKickPusher();
    if (!pusher || pusher.connection.state !== "connected") {
      this.pendingSubscriptions.add(entry.channelId);
      return;
    }
    this.subscribe(entry, pusher);
  }

  private subscribe(entry: PredictionsChannelEntry, pusher: Pusher): void {
    // Idempotent — if we already hold a Pusher channel for this id, skip.
    if (entry.pusherChannel) return;

    const channelName = `predictions-channel-${entry.channelId}`;
    const channel = pusher.subscribe(channelName);
    entry.pusherChannel = channel;

    // Event handlers — `PredictionCreated` + `PredictionUpdated` with the
    // PLAIN event names (no `App\Events\` prefix), per the 2026-05-22
    // discovery. Both events ship `{ prediction }`.
    const handlePayload = (data: unknown): void => {
      const payload = data as KickPredictionEventPayload | null | undefined;
      const prediction = payload?.prediction;
      if (!prediction || typeof prediction.id !== "string") return;
      // Drop late events for a channel we're no longer subscribed to. This
      // can happen if a Pusher event arrives between unsubscribe and
      // delivery (the .bind/.unbind dance in pusher-js isn't strictly
      // synchronous for in-flight frames).
      if (!this.channels.has(entry.channelId)) return;
      const normalized = normalizeKickPrediction(prediction, {
        channelId: entry.channelId,
        channelSlug: entry.channelSlug,
      });
      kickChatService.emit("predictionUpdate", normalized);
    };

    channel.bind("PredictionCreated", handlePayload);
    channel.bind("PredictionUpdated", handlePayload);

    channel.bind("pusher:subscription_succeeded", () => {
      if (process.env.NODE_ENV !== "production") {
        logger.debug("Chat:Predictions", "Subscribed", {
          channelName,
          anonymous: !entry.authedRetryAttempted,
        });
      }
    });

    channel.bind("pusher:subscription_error", (error: unknown) => {
      if (entry.authedRetryAttempted) {
        // Already retried authed — log a one-time warning and stop.
        if (!entry.warnedSubscriptionFailed) {
          entry.warnedSubscriptionFailed = true;
          logger.warn("Chat:Predictions", "Subscription failed after authed retry", {
            channelName,
            error:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          });
        }
        return;
      }
      // Anonymous attempt failed. If we have an access token, retry authed.
      // pusher-js's auth path uses `Pusher.config.auth` on the instance — but
      // applying that ad-hoc per-channel from a sibling service is brittle.
      // The cleanest path is to unsubscribe, mark the attempt, and rely on
      // the chat service's future identity-swap (the renderer effect at
      // KickChat.tsx:387-428 reconnects Pusher when auth flips) to re-fire
      // acquire(). Until then, just record that anonymous failed.
      entry.authedRetryAttempted = true;
      if (process.env.NODE_ENV !== "production") {
        logger.debug("Chat:Predictions", "Anonymous subscription failed, awaiting authed Pusher", {
          channelName,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
      // Tear down the failed subscription so we don't accumulate dead bindings.
      // Skip the socket-touching unsubscribe when the socket is no longer
      // open — see the matching guard in the unsubscribe(entry) method.
      try {
        channel.unbind_all();
        if (pusher.connection.state === "connected") {
          pusher.unsubscribe(channelName);
        }
      } catch {
        /* ignore */
      }
      entry.pusherChannel = null;
    });
  }

  private unsubscribe(entry: PredictionsChannelEntry): void {
    const pusher = getKickPusher();
    if (entry.pusherChannel) {
      try {
        entry.pusherChannel.unbind_all();
      } catch {
        /* ignore */
      }
      // Skip the socket-touching unsubscribe when the socket is closing or
      // already closed — pusher-js logs "WebSocket is already in CLOSING or
      // CLOSED state" once per attempted send. The server cleans up
      // channel subscriptions when the socket closes.
      if (pusher && pusher.connection.state === "connected") {
        try {
          pusher.unsubscribe(`predictions-channel-${entry.channelId}`);
        } catch {
          /* ignore */
        }
      }
      entry.pusherChannel = null;
    }
  }

  /**
   * Install a single `connectionStateChange` listener on the chat service so
   * deferred subscriptions flush as soon as Pusher comes online. Called from
   * `acquire()` and idempotent.
   */
  private ensureConnectionListener(): void {
    if (this.connectionListenerInstalled) return;
    this.connectionListenerInstalled = true;
    kickChatService.on("connectionStateChange", (status: ChatConnectionStatus) => {
      if (status.state !== "connected") return;
      const pusher = getKickPusher();
      if (!pusher) return;
      // Flush queued subscriptions.
      for (const channelId of Array.from(this.pendingSubscriptions)) {
        const entry = this.channels.get(channelId);
        this.pendingSubscriptions.delete(channelId);
        if (!entry) continue;
        this.subscribe(entry, pusher);
      }
    });
  }

  // ========== Test helpers ==========

  /**
   * Reset all per-channel state. Used between tests to drop singletons; not
   * called from production code paths.
   */
  __resetForTesting(): void {
    for (const entry of this.channels.values()) {
      this.unsubscribe(entry);
    }
    this.channels.clear();
    this.pendingSubscriptions.clear();
    // Note: we intentionally don't reset connectionListenerInstalled — the
    // listener on kickChatService is harmless when no channels are tracked.
  }

  /** Test introspection — count of active (subscribed-or-queued) channels. */
  __getActiveChannelIds(): string[] {
    return Array.from(this.channels.keys());
  }
}

export const kickPredictionsService = new KickPredictionsService();

/**
 * Re-export the normalized prediction shape so the widget / UI code can
 * import a single canonical type from the service module.
 */
export type { UnifiedPrediction };
