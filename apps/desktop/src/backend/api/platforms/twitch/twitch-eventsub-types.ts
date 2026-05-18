/**
 * Twitch EventSub WebSocket — shared types.
 *
 * Mirrors the message envelope shape documented at
 * `dev.twitch.tv/docs/eventsub/websocket-reference/` (visited during U8 plan).
 * The concrete event payload (`ChannelModerateEvent`) is a conservative
 * best-effort shape drawn from the published EventSub docs; fields that
 * aren't certain are typed loosely (`unknown` / `Record<string, unknown>`)
 * and the final on-the-wire shape will be validated during U20 manual
 * verification. Any field flagged with `[unverified]` in a JSDoc comment
 * below is one that should be double-checked against a live capture before
 * downstream code reads it.
 */

// ---------------------------------------------------------------------------
// Event types we subscribe to
// ---------------------------------------------------------------------------

export type TwitchEventSubEventType = "channel.moderate";

// ---------------------------------------------------------------------------
// Connection state
// ---------------------------------------------------------------------------

export type TwitchEventSubConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

// ---------------------------------------------------------------------------
// Wire envelope — every message Twitch sends has the same outer shape.
// ---------------------------------------------------------------------------

export interface TwitchEventSubMessage<T = unknown> {
  metadata: {
    message_id: string;
    message_type: string;
    message_timestamp: string;
    subscription_type?: string;
    subscription_version?: string;
  };
  payload: T;
}

// ---------------------------------------------------------------------------
// Session control payloads
// ---------------------------------------------------------------------------

export interface SessionWelcomePayload {
  session: {
    id: string;
    status: "connected";
    keepalive_timeout_seconds: number;
    reconnect_url: string | null;
    connected_at: string;
  };
}

export interface SessionReconnectPayload {
  session: {
    id: string;
    status: "reconnecting";
    keepalive_timeout_seconds: number | null;
    reconnect_url: string;
    connected_at: string;
  };
}

// ---------------------------------------------------------------------------
// Notification + revocation
// ---------------------------------------------------------------------------

export interface NotificationPayload<E = unknown> {
  subscription: {
    id: string;
    type: TwitchEventSubEventType;
    version: string;
    status: string;
    cost: number;
    condition: Record<string, unknown>;
    transport: { method: "websocket"; session_id: string };
    created_at: string;
  };
  event: E;
}

export interface RevocationPayload {
  subscription: {
    id: string;
    type: TwitchEventSubEventType;
    version: string;
    status: string;
    cost: number;
    condition: Record<string, unknown>;
    transport: { method: "websocket"; session_id: string };
    created_at: string;
  };
}

// ---------------------------------------------------------------------------
// Concrete event shapes — see file-header notes about [unverified] fields.
// ---------------------------------------------------------------------------

/**
 * `channel.moderate` v2 event payload (conservative shape).
 * Each event represents one moderation action taken on the broadcaster's
 * channel. `action` is a Twitch-defined string discriminator (e.g.
 * "ban", "timeout", "delete", "raid", "vip", "mod") and the optional
 * structured sub-objects are populated based on the action. Downstream
 * code should treat unfamiliar `action` values defensively.
 */
export interface ChannelModerateEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  moderator_user_id: string;
  moderator_user_login: string;
  moderator_user_name: string;
  /** Twitch-defined moderation action string. */
  action: string;
  /** Present for ban actions. [unverified field name — confirm in U20.] */
  ban?: {
    user_id: string;
    user_login: string;
    user_name: string;
    reason: string | null;
  };
  /** Present for timeout actions. [unverified field name — confirm in U20.] */
  timeout?: {
    user_id: string;
    user_login: string;
    user_name: string;
    reason: string | null;
    expires_at: string;
  };
  /** Present for delete-message actions. [unverified field name.] */
  delete?: {
    user_id: string;
    user_login: string;
    user_name: string;
    message_id: string;
    message_body: string;
  };
  /** Catch-all for action-specific sub-objects we don't model yet. */
  [extra: string]: unknown;
}

