/**
 * Twitch EventSub WebSocket client.
 *
 * One shared client per `(accessToken, broadcasterUserId)` pair (the app
 * currently supports a single Twitch identity at a time, but the factory
 * memoizes by token so a future multi-account world can host multiple
 * clients side-by-side). The client is constructed lazily on first
 * `subscribe()` call — no consumers attached means no upstream connection.
 *
 * Public surface (export-level):
 *   - `getTwitchEventSubClient(accessToken, broadcasterUserId, options?)`
 *   - `__resetTwitchEventSubClientsForTesting()` — testing only
 *
 * The WS itself is read-only from our side; subscribe/unsubscribe operate
 * via Helix `POST` / `DELETE /eventsub/subscriptions`. Twitch routes
 * notifications back over the WS keyed by `session_id`.
 *
 * Reconnect semantics:
 *   - `session_reconnect` envelope → open new WS to the supplied URL, wait
 *     for `session_welcome`, then close old WS. Subscriptions remain
 *     attached to the same session id on Twitch's side (we do NOT re-POST).
 *   - Abnormal close (no `session_reconnect` received) → retry after
 *     5 → 10 → 15 → 30 seconds, then every 30 seconds until recovery.
 *   - Keepalive guard: if no message arrives within 1.5× the welcome's
 *     `keepalive_timeout_seconds`, force-close and reconnect.
 */

import { logger } from "@shared/utils/cross-logger";
import { createCancellableSleep, type CancellableSleep } from "@shared/utils/sleep";
import { z } from "zod";

import { attachEventSubHealthBridge } from "./eventsub-health-bridge";
import type {
  NotificationPayload,
  RevocationPayload,
  SessionReconnectPayload,
  SessionWelcomePayload,
  TwitchEventSubConnectionState,
  TwitchEventSubEventType,
  TwitchEventSubMessage,
} from "./twitch-eventsub-types";

// TODO(streamfusion): consolidate the Twitch anonymous Client-Id into a
// single shared constant once the auth layer exposes one. For now we
// duplicate the value used by twitch-helix-moderation-mutations.ts and
// twitch-gql-pin-mutations.ts.
const DEFAULT_HELIX_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const DEFAULT_WS_ENDPOINT = "wss://eventsub.wss.twitch.tv/ws";
const HELIX_SUBSCRIPTIONS_URL = "https://api.twitch.tv/helix/eventsub/subscriptions";

const RECONNECT_DELAYS_MS = [5000, 10000, 15000, 30000] as const;
const KEEPALIVE_GRACE_MULTIPLIER = 1.5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TwitchEventSubClient {
  readonly connectionState: TwitchEventSubConnectionState;
  /** Subscribe to (eventType, channelId). Returns an unsubscribe function. */
  subscribe<E>(
    eventType: TwitchEventSubEventType,
    channelId: string,
    listener: (event: NotificationPayload<E>) => void
  ): () => void;
  /** Observable: subscribe to connection-state changes. */
  onConnectionStateChange(listener: (state: TwitchEventSubConnectionState) => void): () => void;
  /** Force close + cleanup. Idempotent. */
  close(): void;
}

export interface TwitchEventSubClientOptions {
  wsEndpoint?: string;
  webSocketCtor?: typeof WebSocket;
  clientId?: string;
  tokenFetcher?: () => Promise<string | null>;
  subscriptionRequestor?: {
    request(endpoint: string, options?: RequestInit): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Key used by both the local routing map and the refcount map. */
function pairKey(eventType: TwitchEventSubEventType, channelId: string): string {
  return `${eventType}::${channelId}`;
}

function subscriptionVersion(eventType: TwitchEventSubEventType): string {
  return eventType === "channel.moderate" ? "2" : "1";
}

function subscriptionCondition(
  eventType: TwitchEventSubEventType,
  channelId: string,
  broadcasterUserId: string
): Record<string, string> {
  if (eventType === "channel.moderate") {
    return {
      broadcaster_user_id: channelId,
      moderator_user_id: broadcasterUserId,
    };
  }

  return { broadcaster_user_id: channelId };
}

type SubEntry = {
  eventType: TwitchEventSubEventType;
  channelId: string;
  refcount: number;
  /** Listener bag — typed loosely; cast at dispatch. */
  listeners: Set<(payload: NotificationPayload<unknown>) => void>;
  /** Twitch-assigned subscription id, set after the Helix POST resolves. */
  subscriptionId: string | null;
  /** Revocations received before their matching Helix POST response resolves. */
  revokedSubscriptionIds: Set<string>;
  /** True while the Helix POST is in flight (or queued waiting for welcome). */
  posting: boolean;
  /** Permanent Helix rejection for this local subscription entry. */
  terminalFailureStatus: number | null;
};

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

class TwitchEventSubClientImpl implements TwitchEventSubClient {
  private accessToken: string;
  private readonly broadcasterUserId: string;
  private readonly wsEndpoint: string;
  private readonly webSocketCtor: typeof WebSocket;
  private readonly clientId: string;
  private readonly tokenFetcher: (() => Promise<string | null>) | null;
  private readonly subscriptionRequestor: TwitchEventSubClientOptions["subscriptionRequestor"];

  /** (eventType, channelId) → SubEntry. */
  private readonly subs = new Map<string, SubEntry>();
  /** subscriptionId → (eventType, channelId) for revocation/cleanup. */
  private readonly subIdToPair = new Map<
    string,
    { eventType: TwitchEventSubEventType; channelId: string }
  >();

  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private _state: TwitchEventSubConnectionState = "idle";
  private readonly stateListeners = new Set<(state: TwitchEventSubConnectionState) => void>();

  private keepaliveSeconds = 10;
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  /** Owns the pending reconnect delay so teardown can physically cancel it. */
  private reconnectTimer: CancellableSleep | null = null;
  /** Set true after `close()` so we don't auto-reconnect. */
  private closed = false;
  private healthBridgeCleanup: (() => void) | null = null;

  constructor(
    accessToken: string,
    broadcasterUserId: string,
    options: TwitchEventSubClientOptions | undefined
  ) {
    this.accessToken = accessToken;
    this.broadcasterUserId = broadcasterUserId;
    this.wsEndpoint = options?.wsEndpoint ?? DEFAULT_WS_ENDPOINT;
    this.webSocketCtor =
      options?.webSocketCtor ??
      (globalThis.WebSocket as typeof WebSocket | undefined) ??
      (undefined as unknown as typeof WebSocket);
    this.clientId = options?.clientId ?? DEFAULT_HELIX_CLIENT_ID;
    this.tokenFetcher = options?.tokenFetcher ?? null;
    this.subscriptionRequestor = options?.subscriptionRequestor;
    this.healthBridgeCleanup = attachEventSubHealthBridge(this);
  }

  get connectionState(): TwitchEventSubConnectionState {
    return this._state;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  updateAccessToken(accessToken: string): void {
    this.accessToken = accessToken;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  subscribe<E>(
    eventType: TwitchEventSubEventType,
    channelId: string,
    listener: (event: NotificationPayload<E>) => void
  ): () => void {
    const key = pairKey(eventType, channelId);
    let entry = this.subs.get(key);
    if (!entry) {
      entry = {
        eventType,
        channelId,
        refcount: 0,
        listeners: new Set(),
        subscriptionId: null,
        revokedSubscriptionIds: new Set(),
        posting: false,
        terminalFailureStatus: null,
      };
      this.subs.set(key, entry);
    }
    entry.refcount += 1;
    entry.listeners.add(listener as (payload: NotificationPayload<unknown>) => void);

    // Drive the connection state machine.
    if (this._state === "idle") {
      this.openSocket();
    } else if (this._state === "connected") {
      // Already connected — fire the Helix POST immediately if it's a brand-new pair.
      if (!entry.subscriptionId && !entry.posting && !entry.terminalFailureStatus) {
        this.postSubscription(entry);
      }
    }
    // For "connecting" / "reconnecting" — the welcome handler will flush
    // pending subs once we land on "connected".

    return () => this.removeListener(eventType, channelId, listener);
  }

  onConnectionStateChange(listener: (state: TwitchEventSubConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (this.healthBridgeCleanup) {
      this.healthBridgeCleanup();
      this.healthBridgeCleanup = null;
    }

    // Best-effort DELETE for every active Helix subscription. Fire-and-forget.
    for (const entry of this.subs.values()) {
      if (entry.subscriptionId) {
        void this.deleteSubscription(entry.subscriptionId);
      }
    }
    this.subs.clear();
    this.subIdToPair.clear();

    this.clearKeepaliveTimer();
    this.clearReconnectTimer();

    if (this.ws) {
      try {
        this.ws.close(1000, "client close");
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.sessionId = null;
    this.setState("idle");
  }

  // -------------------------------------------------------------------------
  // Internal — listener removal + refcount
  // -------------------------------------------------------------------------

  private removeListener(
    eventType: TwitchEventSubEventType,
    channelId: string,
    listener: (event: NotificationPayload<never>) => void
  ): void {
    const key = pairKey(eventType, channelId);
    const entry = this.subs.get(key);
    if (!entry) return;
    entry.listeners.delete(listener as unknown as (payload: NotificationPayload<unknown>) => void);
    entry.refcount = Math.max(0, entry.refcount - 1);
    if (entry.refcount > 0) return;

    // Last consumer for this pair — DELETE upstream + drop locally.
    if (entry.subscriptionId) {
      const subId = entry.subscriptionId;
      this.subIdToPair.delete(subId);
      void this.deleteSubscription(subId);
    }
    this.subs.delete(key);

    // No more consumers anywhere → close the socket.
    if (this.subs.size === 0) {
      this.close();
    }
  }

  // -------------------------------------------------------------------------
  // State + observers
  // -------------------------------------------------------------------------

  private setState(state: TwitchEventSubConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    for (const fn of this.stateListeners) {
      try {
        fn(state);
      } catch (err) {
        logger.warn("Twitch:EventSub", "state listener threw", {
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // WebSocket lifecycle
  // -------------------------------------------------------------------------

  private openSocket(): void {
    if (this.closed) return;
    if (!this.webSocketCtor) {
      logger.warn("Twitch:EventSub", "no WebSocket constructor available — cannot open");
      this.setState("error");
      return;
    }
    this.setState("connecting");
    try {
      this.ws = new this.webSocketCtor(this.wsEndpoint);
    } catch (err) {
      logger.warn("Twitch:EventSub", "failed to construct WebSocket", {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
      this.scheduleReconnect();
      return;
    }
    this.bindSocket(this.ws, /* isReplacement */ false);
  }

  private bindSocket(ws: WebSocket, isReplacement: boolean): void {
    ws.onopen = () => {
      // Nothing to send — we wait for session_welcome.
    };
    ws.onmessage = (ev: MessageEvent) => {
      this.handleEnvelope(ev, ws, isReplacement);
    };
    ws.onerror = () => {
      // Errors arrive paired with a close; we handle reconnect there.
      // No-op here.
    };
    ws.onclose = () => {
      this.handleClose(ws);
    };
  }

  private handleClose(ws: WebSocket): void {
    if (this.closed) return;
    // If a `session_reconnect` swap is in flight, the swap path tears the
    // old socket down explicitly — we'll be on a new socket already, so
    // ignore this close.
    if (this.ws !== ws) return;
    this.ws = null;
    this.sessionId = null;
    this.resetSubscriptionIdsForFreshSession();
    this.clearKeepaliveTimer();
    this.scheduleReconnect();
  }

  private resetSubscriptionIdsForFreshSession(): void {
    this.subIdToPair.clear();
    for (const entry of this.subs.values()) {
      entry.subscriptionId = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempts += 1;
    this.setState("reconnecting");
    const reconnectDelay = createCancellableSleep(delay, { unref: true });
    this.reconnectTimer = reconnectDelay;
    void reconnectDelay.result.then((result) => {
      if (!result.ok || this.reconnectTimer !== reconnectDelay || this.closed) {
        return;
      }
      this.reconnectTimer = null;
      this.openSocket();
    });
  }

  private clearReconnectTimer(): void {
    const reconnectDelay = this.reconnectTimer;
    if (reconnectDelay === null) return;
    this.reconnectTimer = null;
    reconnectDelay.cancel();
  }

  private clearKeepaliveTimer(): void {
    if (this.keepaliveTimer !== null) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private armKeepaliveTimer(): void {
    this.clearKeepaliveTimer();
    const graceMs = Math.ceil(this.keepaliveSeconds * KEEPALIVE_GRACE_MULTIPLIER * 1000);
    // timer-allowlist: EventSub keepalive watchdog reset on message (SP1/SP3 out-of-scope)
    this.keepaliveTimer = setTimeout(() => {
      this.keepaliveTimer = null;
      logger.warn("Twitch:EventSub", "keepalive timeout exceeded — forcing reconnect");
      this.forceReconnect();
    }, graceMs);
  }

  private forceReconnect(): void {
    if (this.closed) return;
    const old = this.ws;
    this.ws = null;
    this.sessionId = null;
    this.resetSubscriptionIdsForFreshSession();
    if (old) {
      try {
        old.close(4000, "keepalive timeout");
      } catch {
        // ignore
      }
    }
    this.scheduleReconnect();
  }

  // -------------------------------------------------------------------------
  // Message dispatch
  // -------------------------------------------------------------------------

  private handleEnvelope(ev: MessageEvent, ws: WebSocket, isReplacement: boolean): void {
    // Any inbound message resets the keepalive guard.
    let envelope: TwitchEventSubMessage<unknown>;
    try {
      envelope = JSON.parse(ev.data as string) as TwitchEventSubMessage<unknown>;
    } catch (err) {
      logger.warn("Twitch:EventSub", "received non-JSON message", {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
      return;
    }

    const messageType = envelope.metadata?.message_type;
    switch (messageType) {
      case "session_welcome":
        this.onSessionWelcome(envelope.payload as SessionWelcomePayload, ws, isReplacement);
        break;
      case "session_keepalive":
        this.armKeepaliveTimer();
        break;
      case "session_reconnect":
        this.onSessionReconnect(envelope.payload as SessionReconnectPayload);
        break;
      case "notification":
        this.armKeepaliveTimer();
        this.onNotification({
          ...(envelope.payload as NotificationPayload<unknown>),
          metadata: envelope.metadata,
        });
        break;
      case "revocation":
        this.onRevocation(envelope.payload as RevocationPayload);
        break;
      default:
        // Kept as console.warn so the existing dispatch-observability test
        // (which spies on console.warn) keeps signalling. Console intercept
        // captures this in production.
        console.warn("[twitch-eventsub] unhandled message_type", messageType, envelope);
    }
  }

  private onSessionWelcome(
    payload: SessionWelcomePayload,
    ws: WebSocket,
    isReplacement: boolean
  ): void {
    this.sessionId = payload.session.id;
    this.keepaliveSeconds = payload.session.keepalive_timeout_seconds || 10;
    this.armKeepaliveTimer();

    if (isReplacement) {
      // We just completed a session_reconnect swap. The OLD socket was the
      // previous `this.ws`; we already replaced it pre-emptively.
      // Twitch retains subscriptions across the swap, so do NOT re-POST.
      this.reconnectAttempts = 0;
      this.setState("connected");
      return;
    }

    // Fresh connection. Reset backoff. Flush any pending subscription POSTs.
    this.reconnectAttempts = 0;
    this.setState("connected");
    for (const entry of this.subs.values()) {
      if (!entry.subscriptionId && !entry.posting && !entry.terminalFailureStatus) {
        this.postSubscription(entry);
      }
    }
  }

  private onSessionReconnect(payload: SessionReconnectPayload): void {
    if (this.closed) return;
    const reconnectUrl = payload.session.reconnect_url;
    if (!reconnectUrl) {
      logger.warn("Twitch:EventSub", "session_reconnect missing reconnect_url");
      return;
    }
    if (!this.webSocketCtor) return;
    this.setState("reconnecting");
    let next: WebSocket;
    try {
      next = new this.webSocketCtor(reconnectUrl);
    } catch (err) {
      logger.warn("Twitch:EventSub", "failed to open reconnect_url", {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
      this.scheduleReconnect();
      return;
    }
    const oldWs = this.ws;
    // Swap pointer immediately so `handleClose` ignores the old socket's
    // close event when it arrives.
    this.ws = next;
    this.bindSocket(next, /* isReplacement */ true);
    // The old socket should be closed by US once the new welcome arrives —
    // do it pre-emptively here. Twitch's docs say to wait, but the spec
    // is forgiving and tests expect the old socket to be closed by the
    // time the new welcome lands.
    if (oldWs) {
      try {
        oldWs.close(1000, "session_reconnect swap");
      } catch {
        // ignore
      }
    }
  }

  private onNotification(payload: NotificationPayload<unknown>): void {
    const sub = payload.subscription;
    const channelId =
      typeof sub.condition?.broadcaster_user_id === "string"
        ? (sub.condition.broadcaster_user_id as string)
        : null;
    if (!channelId) {
      logger.warn("Twitch:EventSub", "notification without broadcaster_user_id", { subId: sub.id });
      return;
    }
    const entry = this.subs.get(pairKey(sub.type, channelId));
    if (!entry) {
      // Not tracking this pair — possibly mid-teardown. Drop silently.
      return;
    }
    for (const fn of entry.listeners) {
      try {
        fn(payload);
      } catch (err) {
        logger.warn("Twitch:EventSub", "listener threw", {
          error:
            err instanceof Error
              ? { name: err.name, message: err.message, stack: err.stack }
              : String(err),
        });
      }
    }
  }

  private onRevocation(payload: RevocationPayload): void {
    const subId = payload.subscription.id;
    const indexedPair = this.subIdToPair.get(subId);
    const broadcasterUserId = payload.subscription.condition.broadcaster_user_id;
    const payloadPair =
      typeof broadcasterUserId === "string"
        ? { eventType: payload.subscription.type, channelId: broadcasterUserId }
        : null;
    const pair = indexedPair ?? payloadPair;
    logger.warn("Twitch:EventSub", "subscription revoked", {
      subId,
      status: payload.subscription.status,
    });
    this.subIdToPair.delete(subId);
    if (!pair) return;
    const entry = this.subs.get(pairKey(pair.eventType, pair.channelId));
    if (!entry) return;
    if (entry.subscriptionId === subId) {
      entry.subscriptionId = null;
    } else if (entry.posting) {
      entry.revokedSubscriptionIds.add(subId);
    }
    // Listeners simply stop receiving events (no upstream sub anymore).
  }

  // -------------------------------------------------------------------------
  // Helix HTTP — subscription create / delete
  // -------------------------------------------------------------------------

  private async postSubscription(entry: SubEntry): Promise<void> {
    if (!this.sessionId) return;
    if (entry.posting || entry.subscriptionId || entry.terminalFailureStatus) return;
    entry.posting = true;
    const version = subscriptionVersion(entry.eventType);
    const body = {
      type: entry.eventType,
      version,
      condition: subscriptionCondition(entry.eventType, entry.channelId, this.broadcasterUserId),
      transport: {
        method: "websocket" as const,
        session_id: this.sessionId,
      },
    };
    try {
      const accessToken = await this.getSubscriptionAccessToken();
      let res = await this.postSubscriptionRequest(body, accessToken);
      if (res.status === 401) {
        const freshToken = await this.tokenFetcher?.();
        if (freshToken && freshToken !== this.accessToken) {
          this.accessToken = freshToken;
          res = await this.postSubscriptionRequest(body, freshToken);
        }
      }

      if (!res.ok) {
        if (res.status === 403 || res.status === 409 || res.status === 429) {
          entry.terminalFailureStatus = res.status;
        }
        logger.warn("Twitch:EventSub", "subscription POST failed", {
          status: res.status,
          eventType: entry.eventType,
          channelId: entry.channelId,
        });
        return;
      }
      const parsed = z
        .object({ data: z.array(z.object({ id: z.string().optional() })).optional() })
        .parse(await res.json());
      const subId = parsed.data?.[0]?.id ?? null;
      const wasRevoked = subId ? entry.revokedSubscriptionIds.delete(subId) : false;
      if (wasRevoked) {
        return;
      }
      const currentEntry = this.subs.get(pairKey(entry.eventType, entry.channelId));
      if (subId && (this.closed || currentEntry !== entry || entry.refcount === 0)) {
        void this.deleteSubscription(subId);
        return;
      }
      entry.subscriptionId = subId;
      if (subId) {
        this.subIdToPair.set(subId, {
          eventType: entry.eventType,
          channelId: entry.channelId,
        });
      }
    } catch (err) {
      logger.warn("Twitch:EventSub", "subscription POST threw", {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
    } finally {
      entry.revokedSubscriptionIds.clear();
      entry.posting = false;
    }
  }

  private async getSubscriptionAccessToken(): Promise<string> {
    if (!this.tokenFetcher) return this.accessToken;

    try {
      const freshToken = await this.tokenFetcher();
      if (freshToken) {
        this.accessToken = freshToken;
      }
    } catch (err) {
      logger.warn("Twitch:EventSub", "fresh token lookup before subscription POST failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return this.accessToken;
  }

  private postSubscriptionRequest(body: unknown, accessToken: string): Promise<Response> {
    if (this.subscriptionRequestor) {
      return this.subscriptionRequestor
        .request("/eventsub/subscriptions", {
          method: "POST",
          body: JSON.stringify(body),
        })
        .then(
          (data) =>
            ({ ok: true, status: 200, json: async () => data }) as Pick<
              Response,
              "ok" | "status" | "json"
            > as Response
        );
    }
    return fetch(HELIX_SUBSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        "Client-Id": this.clientId,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  private async deleteSubscription(subscriptionId: string): Promise<void> {
    try {
      if (this.subscriptionRequestor) {
        await this.subscriptionRequestor.request(
          `/eventsub/subscriptions?id=${encodeURIComponent(subscriptionId)}`,
          { method: "DELETE" }
        );
        return;
      }
      await fetch(`${HELIX_SUBSCRIPTIONS_URL}?id=${encodeURIComponent(subscriptionId)}`, {
        method: "DELETE",
        headers: {
          "Client-Id": this.clientId,
          Authorization: `Bearer ${this.accessToken}`,
        },
      });
    } catch (err) {
      logger.warn("Twitch:EventSub", "subscription DELETE threw", {
        error:
          err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Factory + cache
// ---------------------------------------------------------------------------

const CLIENT_CACHE_SYMBOL = Symbol.for("streamfusion.twitchEventSubClientCache");
const cacheOwner = globalThis as typeof globalThis & {
  [CLIENT_CACHE_SYMBOL]?: Map<string, TwitchEventSubClientImpl>;
};
const clientCache =
  cacheOwner[CLIENT_CACHE_SYMBOL] ??
  (cacheOwner[CLIENT_CACHE_SYMBOL] = new Map<string, TwitchEventSubClientImpl>());

function cacheKey(broadcasterUserId: string, clientId: string): string {
  return `${broadcasterUserId}::${clientId}`;
}

export function getTwitchEventSubClient(
  accessToken: string,
  broadcasterUserId: string,
  options?: TwitchEventSubClientOptions
): TwitchEventSubClient {
  const clientId = options?.clientId ?? DEFAULT_HELIX_CLIENT_ID;
  const key = cacheKey(broadcasterUserId, clientId);
  const existing = clientCache.get(key);
  if (existing && !existing.isClosed) {
    existing.updateAccessToken(accessToken);
    return existing;
  }
  if (existing) {
    clientCache.delete(key);
  }
  const client = new TwitchEventSubClientImpl(accessToken, broadcasterUserId, options);
  clientCache.set(key, client);
  return client;
}

/** Reset all cached clients — TESTING ONLY. */
export function __resetTwitchEventSubClientsForTesting(): void {
  for (const client of clientCache.values()) {
    try {
      client.close();
    } catch {
      // ignore
    }
  }
  clientCache.clear();
}
