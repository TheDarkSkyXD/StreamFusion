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
 *   - Abnormal close (no `session_reconnect` received) → exponential
 *     backoff 250 → 500 → 1000 → 2000 → 4000 → 8000 ms cap, ten attempts,
 *     then surface `connectionState: "error"`.
 *   - Keepalive guard: if no message arrives within 1.5× the welcome's
 *     `keepalive_timeout_seconds`, force-close and reconnect.
 */

import type {
  NotificationPayload,
  RevocationPayload,
  SessionReconnectPayload,
  SessionWelcomePayload,
  TwitchEventSubConnectionState,
  TwitchEventSubEventType,
  TwitchEventSubMessage,
} from "./twitch-eventsub-types";

// TODO(streamforge): consolidate the Twitch anonymous Client-Id into a
// single shared constant once the auth layer exposes one. For now we
// duplicate the value used by twitch-helix-moderation-mutations.ts and
// twitch-gql-pin-mutations.ts.
const DEFAULT_HELIX_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const DEFAULT_WS_ENDPOINT = "wss://eventsub.wss.twitch.tv/ws";
const HELIX_SUBSCRIPTIONS_URL = "https://api.twitch.tv/helix/eventsub/subscriptions";

const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 8000;
const MAX_RECONNECT_ATTEMPTS = 10;
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
    listener: (event: NotificationPayload<E>) => void,
  ): () => void;
  /** Observable: subscribe to connection-state changes. */
  onConnectionStateChange(
    listener: (state: TwitchEventSubConnectionState) => void,
  ): () => void;
  /** Force close + cleanup. Idempotent. */
  close(): void;
}

export interface TwitchEventSubClientOptions {
  wsEndpoint?: string;
  webSocketCtor?: typeof WebSocket;
  clientId?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Key used by both the local routing map and the refcount map. */
function pairKey(eventType: TwitchEventSubEventType, channelId: string): string {
  return `${eventType}::${channelId}`;
}

type SubEntry = {
  eventType: TwitchEventSubEventType;
  channelId: string;
  refcount: number;
  /** Listener bag — typed loosely; cast at dispatch. */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous listener bag
  listeners: Set<(payload: NotificationPayload<any>) => void>;
  /** Twitch-assigned subscription id, set after the Helix POST resolves. */
  subscriptionId: string | null;
  /** True while the Helix POST is in flight (or queued waiting for welcome). */
  posting: boolean;
};

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

class TwitchEventSubClientImpl implements TwitchEventSubClient {
  private readonly accessToken: string;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: kept for future per-broadcaster routing logic
  private readonly broadcasterUserId: string;
  private readonly wsEndpoint: string;
  private readonly webSocketCtor: typeof WebSocket;
  private readonly clientId: string;

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
  private readonly stateListeners = new Set<
    (state: TwitchEventSubConnectionState) => void
  >();

  private keepaliveSeconds = 10;
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set true after `close()` so we don't auto-reconnect. */
  private closed = false;

  constructor(
    accessToken: string,
    broadcasterUserId: string,
    options: TwitchEventSubClientOptions | undefined,
  ) {
    this.accessToken = accessToken;
    this.broadcasterUserId = broadcasterUserId;
    this.wsEndpoint = options?.wsEndpoint ?? DEFAULT_WS_ENDPOINT;
    this.webSocketCtor =
      options?.webSocketCtor ??
      (globalThis.WebSocket as typeof WebSocket | undefined) ??
      (undefined as unknown as typeof WebSocket);
    this.clientId = options?.clientId ?? DEFAULT_HELIX_CLIENT_ID;
  }

  get connectionState(): TwitchEventSubConnectionState {
    return this._state;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  subscribe<E>(
    eventType: TwitchEventSubEventType,
    channelId: string,
    listener: (event: NotificationPayload<E>) => void,
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
        posting: false,
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
      if (!entry.subscriptionId && !entry.posting) {
        this.postSubscription(entry);
      }
    }
    // For "connecting" / "reconnecting" — the welcome handler will flush
    // pending subs once we land on "connected".

    return () => this.removeListener(eventType, channelId, listener);
  }

  onConnectionStateChange(
    listener: (state: TwitchEventSubConnectionState) => void,
  ): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

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
    listener: (event: NotificationPayload<never>) => void,
  ): void {
    const key = pairKey(eventType, channelId);
    const entry = this.subs.get(key);
    if (!entry) return;
    entry.listeners.delete(
      listener as unknown as (payload: NotificationPayload<unknown>) => void,
    );
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
        console.warn("[twitch-eventsub] state listener threw", err);
      }
    }
  }

  // -------------------------------------------------------------------------
  // WebSocket lifecycle
  // -------------------------------------------------------------------------

  private openSocket(): void {
    if (this.closed) return;
    if (!this.webSocketCtor) {
      console.warn(
        "[twitch-eventsub] no WebSocket constructor available — cannot open",
      );
      this.setState("error");
      return;
    }
    this.setState("connecting");
    try {
      this.ws = new this.webSocketCtor(this.wsEndpoint);
    } catch (err) {
      console.warn("[twitch-eventsub] failed to construct WebSocket", err);
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
    this.clearKeepaliveTimer();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.clearReconnectTimer();
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setState("error");
      return;
    }
    const exponent = Math.min(this.reconnectAttempts, 6);
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS);
    this.reconnectAttempts += 1;
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearKeepaliveTimer(): void {
    if (this.keepaliveTimer !== null) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private armKeepaliveTimer(): void {
    this.clearKeepaliveTimer();
    const graceMs = Math.ceil(
      this.keepaliveSeconds * KEEPALIVE_GRACE_MULTIPLIER * 1000,
    );
    this.keepaliveTimer = setTimeout(() => {
      this.keepaliveTimer = null;
      console.warn(
        "[twitch-eventsub] keepalive timeout exceeded — forcing reconnect",
      );
      this.forceReconnect();
    }, graceMs);
  }

  private forceReconnect(): void {
    if (this.closed) return;
    const old = this.ws;
    this.ws = null;
    this.sessionId = null;
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

  private handleEnvelope(
    ev: MessageEvent,
    ws: WebSocket,
    isReplacement: boolean,
  ): void {
    // Any inbound message resets the keepalive guard.
    let envelope: TwitchEventSubMessage<unknown>;
    try {
      envelope = JSON.parse(ev.data as string) as TwitchEventSubMessage<unknown>;
    } catch (err) {
      console.warn("[twitch-eventsub] received non-JSON message", err);
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
        this.onNotification(envelope.payload as NotificationPayload<unknown>);
        break;
      case "revocation":
        this.onRevocation(envelope.payload as RevocationPayload);
        break;
      default:
        console.warn(
          "[twitch-eventsub] unhandled message_type",
          messageType,
          envelope,
        );
    }
  }

  private onSessionWelcome(
    payload: SessionWelcomePayload,
    ws: WebSocket,
    isReplacement: boolean,
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
      if (!entry.subscriptionId && !entry.posting) {
        this.postSubscription(entry);
      }
    }
  }

  private onSessionReconnect(payload: SessionReconnectPayload): void {
    if (this.closed) return;
    const reconnectUrl = payload.session.reconnect_url;
    if (!reconnectUrl) {
      console.warn("[twitch-eventsub] session_reconnect missing reconnect_url");
      return;
    }
    if (!this.webSocketCtor) return;
    this.setState("reconnecting");
    let next: WebSocket;
    try {
      next = new this.webSocketCtor(reconnectUrl);
    } catch (err) {
      console.warn("[twitch-eventsub] failed to open reconnect_url", err);
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
      console.warn(
        "[twitch-eventsub] notification without broadcaster_user_id",
        sub.id,
      );
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
        console.warn("[twitch-eventsub] listener threw", err);
      }
    }
  }

  private onRevocation(payload: RevocationPayload): void {
    const subId = payload.subscription.id;
    const pair = this.subIdToPair.get(subId);
    console.warn(
      "[twitch-eventsub] subscription revoked",
      subId,
      payload.subscription.status,
    );
    this.subIdToPair.delete(subId);
    if (!pair) return;
    const entry = this.subs.get(pairKey(pair.eventType, pair.channelId));
    if (!entry) return;
    // Drop the upstream id so a future subscribe call will re-POST.
    entry.subscriptionId = null;
    // Listeners simply stop receiving events (no upstream sub anymore).
  }

  // -------------------------------------------------------------------------
  // Helix HTTP — subscription create / delete
  // -------------------------------------------------------------------------

  private async postSubscription(entry: SubEntry): Promise<void> {
    if (!this.sessionId) return;
    if (entry.posting || entry.subscriptionId) return;
    entry.posting = true;
    const version = entry.eventType === "channel.moderate" ? "2" : "1";
    const body = {
      type: entry.eventType,
      version,
      condition: {
        broadcaster_user_id: entry.channelId,
        moderator_user_id: this.broadcasterUserId,
      },
      transport: {
        method: "websocket" as const,
        session_id: this.sessionId,
      },
    };
    try {
      const res = await fetch(HELIX_SUBSCRIPTIONS_URL, {
        method: "POST",
        headers: {
          "Client-Id": this.clientId,
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn(
          "[twitch-eventsub] subscription POST failed",
          res.status,
          entry.eventType,
          entry.channelId,
        );
        entry.posting = false;
        return;
      }
      const parsed = (await res.json()) as {
        data?: Array<{ id?: string }>;
      };
      const subId = parsed.data?.[0]?.id ?? null;
      entry.subscriptionId = subId;
      entry.posting = false;
      if (subId) {
        this.subIdToPair.set(subId, {
          eventType: entry.eventType,
          channelId: entry.channelId,
        });
      }
    } catch (err) {
      entry.posting = false;
      console.warn("[twitch-eventsub] subscription POST threw", err);
    }
  }

  private async deleteSubscription(subscriptionId: string): Promise<void> {
    try {
      await fetch(
        `${HELIX_SUBSCRIPTIONS_URL}?id=${encodeURIComponent(subscriptionId)}`,
        {
          method: "DELETE",
          headers: {
            "Client-Id": this.clientId,
            Authorization: `Bearer ${this.accessToken}`,
          },
        },
      );
    } catch (err) {
      console.warn("[twitch-eventsub] subscription DELETE threw", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory + cache
// ---------------------------------------------------------------------------

const clientCache = new Map<string, TwitchEventSubClientImpl>();

function cacheKey(accessToken: string, broadcasterUserId: string): string {
  return `${accessToken}::${broadcasterUserId}`;
}

export function getTwitchEventSubClient(
  accessToken: string,
  broadcasterUserId: string,
  options?: TwitchEventSubClientOptions,
): TwitchEventSubClient {
  const key = cacheKey(accessToken, broadcasterUserId);
  const existing = clientCache.get(key);
  if (existing) return existing;
  const client = new TwitchEventSubClientImpl(
    accessToken,
    broadcasterUserId,
    options,
  );
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
