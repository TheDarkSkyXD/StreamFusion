/**
 * mod-log-writer.ts
 *
 * U12: Long-lived service that consumes multiple mod-action event sources and
 * writes deduped entries to the `mod_log` SQLite table (U2).
 *
 * Sources the API supports (one method per source; consumers wire them later):
 *   1. EventSub `channel.moderate` notifications  → ingestEventSubModerate(...)
 *   2. Local mutation success callbacks (U11)     → record({ source: "local", ... })
 *   3. Twitch IRC CLEARCHAT / CLEARMSG events     → record({ source: "irc", ... })
 *   4. Kick chatroom Pusher events                → record({ source: "pusher", ... })
 *   5. Bootstrap from Helix /moderation/banned    → bootstrapFromHelix(...)
 *
 * Dedup rule (R34): if a record arrives within ±2s of a previously-recorded
 * action on the same (channelId, action, targetUserId) tuple AND comes from a
 * different source, the new entry is suppressed. This collapses the
 * local-mutation → EventSub round-trip into a single row.
 *
 * Retention (AE10 / R33): `initialize()` runs the retention sweep exactly once
 * at startup. No periodic sweep — the plan says retention is a startup-only
 * operation.
 *
 * Runtime location: this module is imported by renderer-side code
 * (EngagementPolls, EngagementPredictions). It therefore CANNOT touch
 * better-sqlite3 directly. All persistence goes through the
 * `window.electronAPI.modLog.*` IPC bridge; the dedup buffer and EventSub
 * translation stay renderer-side.
 */

import type {
  ChannelModerateEvent,
  NotificationPayload,
} from "@/backend/api/platforms/twitch/twitch-eventsub-types";
import type { ModLogEntry } from "@/shared/mod-log-types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ModLogAction =
  | "ban"
  | "timeout"
  | "unban"
  | "delete"
  | "clear"
  | "shield"
  | "raid"
  | "commercial"
  | "uniqueChat"
  | "prediction-start"
  | "prediction-lock"
  | "prediction-resolve"
  | "prediction-cancel"
  | "poll-start"
  | "poll-terminate";

export type ModLogSource = "local" | "eventsub" | "irc" | "pusher" | "bootstrap";

export interface RecordModActionInput {
  channelId: string;
  channelSlug: string;
  action: ModLogAction;
  targetUserId: string;
  targetUsername: string;
  moderatorUserId: string;
  moderatorUsername: string;
  durationSeconds?: number | null;
  reason?: string | null;
  /** When the action happened (ms epoch). Defaults to `Date.now()`. */
  occurredAt?: number;
  /** Source — affects dedup. */
  source: ModLogSource;
}

// ---------------------------------------------------------------------------
// Internal — dedup buffer
// ---------------------------------------------------------------------------

const DEDUP_WINDOW_MS = 2_000;
const DEDUP_BUFFER_MAX = 500;

interface DedupEntry {
  key: string;
  ts: number;
  source: ModLogSource;
}

// ---------------------------------------------------------------------------
// Helix banned response (only the fields we read)
// ---------------------------------------------------------------------------

interface HelixBannedUser {
  user_id: string;
  user_login: string;
  user_name: string;
  expires_at?: string | null;
  created_at: string;
  reason?: string | null;
  moderator_id: string;
  moderator_login: string;
  moderator_name: string;
}

interface HelixBannedResponse {
  data: HelixBannedUser[];
  pagination?: { cursor?: string };
}

const HELIX_BOOTSTRAP_PAGE_CAP = 20;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ModLogWriter {
  private initialized = false;
  private recent: DedupEntry[] = [];
  /** Latched once per process so we only warn once for unknown sub-actions. */
  private warnedUnknownActions = new Set<string>();

  /** Idempotent setup. Runs the AE10 retention sweep on first call only. */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      await window.electronAPI.modLog.sweepRetention();
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: surfacing init failure
      console.warn("[mod-log-writer] retention sweep failed during initialize()", err);
    }
  }

  /**
   * Record an action. Returns the new mod_log id, or `null` if the entry was
   * deduplicated against a recent record from a different source.
   *
   * The dedup check is synchronous (renderer-side buffer); the actual SQL
   * insert is awaited over IPC.
   */
  async record(input: RecordModActionInput): Promise<number | null> {
    const occurredAt = input.occurredAt ?? Date.now();
    const key = dedupKey(input.channelId, input.action, input.targetUserId);

    // Prune ancient buffer entries lazily — keep memory bounded.
    if (this.recent.length > DEDUP_BUFFER_MAX) {
      this.recent = this.recent.slice(-DEDUP_BUFFER_MAX);
    }

    for (const entry of this.recent) {
      if (
        entry.key === key &&
        entry.source !== input.source &&
        Math.abs(entry.ts - occurredAt) <= DEDUP_WINDOW_MS
      ) {
        // Suppress: canonical first-seen row already exists.
        return null;
      }
    }

    // Mark the buffer BEFORE the await so a concurrent same-key insert from a
    // different source still dedups.
    this.recent.push({ key, ts: occurredAt, source: input.source });

    const id = await window.electronAPI.modLog.insert({
      channelId: input.channelId,
      channelSlug: input.channelSlug,
      action: input.action,
      targetUserId: input.targetUserId,
      targetUsername: input.targetUsername,
      moderatorUserId: input.moderatorUserId,
      moderatorUsername: input.moderatorUsername,
      durationSeconds: input.durationSeconds ?? null,
      reason: input.reason ?? null,
      createdAt: occurredAt,
    });
    return id;
  }

  /**
   * Translate a Twitch EventSub `channel.moderate` notification into one or
   * more `record(...)` calls. Defensive against unknown sub-action keys —
   * `console.warn`s once per unknown action type and skips.
   *
   * Field-shape assumptions (see twitch-eventsub-types.ts):
   *   - event.action discriminates the sub-action ("ban" | "timeout" | "unban" | "delete" | ...)
   *   - event.ban: { user_id, user_login, user_name, reason }
   *   - event.timeout: { user_id, user_login, user_name, reason, expires_at }
   *   - event.delete: { user_id, user_login, user_name, message_id, message_body }
   *   - event.unban: { user_id, user_login, user_name } (assumed — confirmed at U20)
   */
  async ingestEventSubModerate(
    payload: NotificationPayload<ChannelModerateEvent>,
  ): Promise<void> {
    const event = payload.event;
    const channelId = event.broadcaster_user_id;
    const channelSlug = event.broadcaster_user_login;
    const moderatorUserId = event.moderator_user_id;
    const moderatorUsername = event.moderator_user_login;
    const occurredAt = Date.parse(payload.subscription?.created_at ?? "") || Date.now();
    const action = event.action;

    switch (action) {
      case "ban": {
        const sub = event.ban;
        if (!sub) return this.warnUnknown("ban-missing-payload");
        await this.record({
          channelId,
          channelSlug,
          action: "ban",
          targetUserId: sub.user_id,
          targetUsername: sub.user_login,
          moderatorUserId,
          moderatorUsername,
          durationSeconds: null,
          reason: sub.reason ?? null,
          occurredAt,
          source: "eventsub",
        });
        return;
      }
      case "timeout": {
        const sub = event.timeout;
        if (!sub) return this.warnUnknown("timeout-missing-payload");
        const expiresMs = Date.parse(sub.expires_at);
        const durationSeconds = Number.isFinite(expiresMs)
          ? Math.max(0, Math.floor((expiresMs - occurredAt) / 1000))
          : null;
        await this.record({
          channelId,
          channelSlug,
          action: "timeout",
          targetUserId: sub.user_id,
          targetUsername: sub.user_login,
          moderatorUserId,
          moderatorUsername,
          durationSeconds,
          reason: sub.reason ?? null,
          occurredAt,
          source: "eventsub",
        });
        return;
      }
      case "unban": {
        // The shape of event.unban is unverified — fall back to a generic
        // `{ user_id, user_login }` read on the raw event payload.
        const sub = (event as Record<string, unknown>).unban as
          | { user_id?: string; user_login?: string; user_name?: string }
          | undefined;
        if (!sub?.user_id || !sub?.user_login) {
          return this.warnUnknown("unban-missing-payload");
        }
        await this.record({
          channelId,
          channelSlug,
          action: "unban",
          targetUserId: sub.user_id,
          targetUsername: sub.user_login,
          moderatorUserId,
          moderatorUsername,
          durationSeconds: null,
          reason: null,
          occurredAt,
          source: "eventsub",
        });
        return;
      }
      case "delete": {
        const sub = event.delete;
        if (!sub) return this.warnUnknown("delete-missing-payload");
        await this.record({
          channelId,
          channelSlug,
          action: "delete",
          targetUserId: sub.user_id,
          targetUsername: sub.user_login,
          moderatorUserId,
          moderatorUsername,
          durationSeconds: null,
          reason: sub.message_body ?? null,
          occurredAt,
          source: "eventsub",
        });
        return;
      }
      default:
        this.warnUnknown(action);
        return;
    }
  }

  /**
   * Bootstrap from Helix /moderation/banned. Walks pages until exhausted (cap
   * at 20). Skips entries that already exist (idempotent across reconnects).
   * Returns the count of newly-inserted rows.
   */
  async bootstrapFromHelix(opts: {
    channelId: string;
    channelSlug: string;
    accessToken: string;
    fetchImpl?: typeof fetch;
    clientId?: string;
  }): Promise<number> {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      // biome-ignore lint/suspicious/noConsole: surfacing missing fetch
      console.warn("[mod-log-writer] bootstrapFromHelix: no fetch implementation available");
      return 0;
    }

    let cursor: string | undefined;
    let pages = 0;
    let inserted = 0;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.accessToken}`,
    };
    if (opts.clientId) headers["Client-Id"] = opts.clientId;

    while (pages < HELIX_BOOTSTRAP_PAGE_CAP) {
      const url = new URL("https://api.twitch.tv/helix/moderation/banned");
      url.searchParams.set("broadcaster_id", opts.channelId);
      url.searchParams.set("first", "100");
      if (cursor) url.searchParams.set("after", cursor);

      let res: Response;
      try {
        res = await fetchImpl(url.toString(), { headers });
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: surfacing network failure
        console.warn("[mod-log-writer] bootstrapFromHelix fetch failed", err);
        return inserted;
      }

      if (!res.ok) {
        // biome-ignore lint/suspicious/noConsole: surfacing API failure
        console.warn(
          `[mod-log-writer] bootstrapFromHelix HTTP ${res.status} on page ${pages + 1}`
        );
        return inserted;
      }

      let body: HelixBannedResponse;
      try {
        body = (await res.json()) as HelixBannedResponse;
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: surfacing JSON parse error
        console.warn("[mod-log-writer] bootstrapFromHelix JSON parse failed", err);
        return inserted;
      }

      const now = Date.now();
      for (const row of body.data ?? []) {
        const createdAt = Date.parse(row.created_at) || now;
        const expiresMs = row.expires_at ? Date.parse(row.expires_at) : null;
        const action: ModLogAction = expiresMs ? "timeout" : "ban";
        const durationSeconds =
          expiresMs && Number.isFinite(expiresMs)
            ? Math.max(0, Math.floor((expiresMs - now) / 1000))
            : null;

        // Idempotent: skip if a row with the same (channelId, targetUserId,
        // action) already exists within ±5s of this createdAt.
        const existing = await window.electronAPI.modLog.query({
          channelId: opts.channelId,
          targetUserId: row.user_id,
          action,
          limit: 50,
        });
        const dupe = Array.isArray(existing)
          ? existing.some((e) => Math.abs(e.createdAt - createdAt) <= 5_000)
          : false;
        if (dupe) continue;

        await window.electronAPI.modLog.insert({
          channelId: opts.channelId,
          channelSlug: opts.channelSlug,
          action,
          targetUserId: row.user_id,
          targetUsername: row.user_login,
          moderatorUserId: row.moderator_id,
          moderatorUsername: row.moderator_login,
          durationSeconds,
          reason: row.reason ?? null,
          createdAt,
        });
        inserted += 1;
      }

      cursor = body.pagination?.cursor;
      pages += 1;
      if (!cursor) break;
    }

    return inserted;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private warnUnknown(key: string): void {
    if (this.warnedUnknownActions.has(key)) return;
    this.warnedUnknownActions.add(key);
    // biome-ignore lint/suspicious/noConsole: defensive warning per plan
    console.warn(`[mod-log-writer] ignoring unknown channel.moderate sub-action: ${key}`);
  }
}

function dedupKey(channelId: string, action: string, targetUserId: string): string {
  return `${channelId}|${action}|${targetUserId}`;
}

// ---------------------------------------------------------------------------
// Singleton + test reset
// ---------------------------------------------------------------------------

export const modLogWriter = new ModLogWriter();

/** Reset state — TESTING ONLY. */
export function __resetModLogWriterForTesting(): void {
  // Reach into the singleton and clear private state without re-creating it,
  // so import-time references continue to work.
  // biome-ignore lint/suspicious/noExplicitAny: test-only escape hatch
  const w = modLogWriter as any;
  w.initialized = false;
  w.recent = [];
  w.warnedUnknownActions = new Set<string>();
}

// Re-export for hook consumers.
export type { ModLogEntry };
