/**
 * Twitch Hermes WebSocket client — viewer-side real-time prediction reader.
 *
 * Protocol reverse-engineered from `reference/Xtra For-Twitch-Better-Functions-
 * etc-master/app/src/main/java/com/github/andreyasadchy/xtra/util/chat/HermesWebSocket.kt`.
 * Twitch's web client uses this channel as the post-PubSub-shutdown delivery
 * for prediction / poll / raid / community-points events. Anonymous subscribe
 * works for the `predictions-channel-v1.<channelId>` topic — no broadcaster
 * OAuth grant required.
 *
 * Frame protocol:
 *   server → welcome   { type: "welcome", welcome: { keepaliveSec } }
 *   client → subscribe { type: "subscribe", id, subscribe: { id, type: "pubsub", pubsub: { topic } } }
 *   server → notification { type: "notification", notification: { subscription: { id }, pubsub: "<stringified inner JSON>" } }
 *   server → keepalive { type: "keepalive" } — bounces our pong timer
 *   server → reconnect { type: "reconnect", reconnect: { url } } — graceful resub
 *
 * Inner pubsub for predictions-channel-v1.<channelId>:
 *   { data: { event: { id, created_at, title, status, prediction_window_seconds,
 *     winning_outcome_id, outcomes: [{ id, title, total_points, total_users,
 *     color?, top_predictors? }] } } }
 *
 * The optional `color` and `top_predictors` fields are observed in twitch.tv's
 * live payload but were NOT extracted by Xtra. The parser below extracts them
 * defensively — present when twitch.tv sends them, null otherwise.
 */

import { EventEmitter } from "../../../shared/browser-event-emitter";
import type {
  UnifiedPrediction,
  UnifiedPredictionOutcome,
} from "../../../shared/chat-types";

const HERMES_URL =
  "wss://hermes.twitch.tv/v1?clientId=kimne78kx3ncx6brgo4mv6wki5h1ko";
const DEFAULT_KEEPALIVE_MS = 15_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

type Status = "ACTIVE" | "LOCKED" | "RESOLVED" | "CANCELED";

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "ACTIVE",
  "LOCKED",
  "RESOLVED",
  "CANCELED",
]);

interface HermesClientEvents {
  prediction: (prediction: UnifiedPrediction) => void;
  /** Diagnostic — fires on connect / reconnect / disconnect. */
  state: (state: "connecting" | "connected" | "disconnected") => void;
}

type Listener<T extends keyof HermesClientEvents> = HermesClientEvents[T];

/**
 * Per-channel Hermes subscription. Owns one WebSocket; auto-reconnects with
 * exponential backoff. Emits parsed `UnifiedPrediction` shapes through the
 * `prediction` event for the consumer to forward to `twitchChatService`.
 */
export class TwitchHermesClient {
  private ws: WebSocket | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepaliveMs = DEFAULT_KEEPALIVE_MS;
  private reconnectAttempts = 0;
  private subscriptionId: string | null = null;
  private emitter = new EventEmitter();
  private handledMessageIds = new Set<string>();
  private active = false;

  constructor(private readonly channelId: string) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.connect();
  }

  stop(): void {
    this.active = false;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.emitter.emit("state", "disconnected");
  }

  on<T extends keyof HermesClientEvents>(event: T, listener: Listener<T>): void {
    this.emitter.on(event, listener);
  }

  off<T extends keyof HermesClientEvents>(event: T, listener: Listener<T>): void {
    this.emitter.off(event, listener);
  }

  private connect(): void {
    if (!this.active) return;
    this.emitter.emit("state", "connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(HERMES_URL);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.emitter.emit("state", "connected");
    };
    ws.onmessage = (event) => this.handleMessage(event.data);
    ws.onerror = () => {
      // Surface as disconnect — onclose follows.
    };
    ws.onclose = () => {
      this.ws = null;
      this.clearTimers();
      this.emitter.emit("state", "disconnected");
      if (this.active) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.active || this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private resetPongTimer(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      // Server hasn't pinged us in keepaliveMs — assume dead; close + reconnect.
      try {
        this.ws?.close();
      } catch {
        // ignore
      }
    }, this.keepaliveMs);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isObject(frame)) return;

    const messageId = typeof frame.id === "string" ? frame.id : null;
    if (messageId) {
      if (this.handledMessageIds.has(messageId)) return;
      if (this.handledMessageIds.size > 200) {
        const first = this.handledMessageIds.values().next().value;
        if (first !== undefined) this.handledMessageIds.delete(first);
      }
      this.handledMessageIds.add(messageId);
    }

    const type = typeof frame.type === "string" ? frame.type : "";
    switch (type) {
      case "welcome":
        this.handleWelcome(frame);
        return;
      case "keepalive":
        this.resetPongTimer();
        return;
      case "reconnect":
        try {
          this.ws?.close();
        } catch {
          // ignore — onclose will trigger reconnect
        }
        return;
      case "notification":
        this.handleNotification(frame);
        return;
    }
  }

  private handleWelcome(frame: Record<string, unknown>): void {
    const welcome = isObject(frame.welcome) ? frame.welcome : null;
    const seconds = welcome && typeof welcome.keepaliveSec === "number" ? welcome.keepaliveSec : 0;
    if (seconds > 0) this.keepaliveMs = seconds * 1000;
    this.resetPongTimer();
    this.subscribePrediction();
  }

  private subscribePrediction(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const subId = makeId();
    this.subscriptionId = subId;
    const frame = {
      type: "subscribe",
      id: makeId(),
      subscribe: {
        id: subId,
        type: "pubsub",
        pubsub: { topic: `predictions-channel-v1.${this.channelId}` },
      },
      timestamp: new Date().toISOString(),
    };
    try {
      this.ws.send(JSON.stringify(frame));
    } catch {
      // ignore — disconnect path will retry
    }
  }

  private handleNotification(frame: Record<string, unknown>): void {
    this.resetPongTimer();
    const notif = isObject(frame.notification) ? frame.notification : null;
    if (!notif) return;
    const sub = isObject(notif.subscription) ? notif.subscription : null;
    if (!sub || sub.id !== this.subscriptionId) return; // not our topic
    const pubsubRaw = notif.pubsub;
    if (typeof pubsubRaw !== "string") return;
    let inner: unknown;
    try {
      inner = JSON.parse(pubsubRaw);
    } catch {
      return;
    }
    const prediction = parsePredictionEvent(inner, this.channelId);
    if (prediction) this.emitter.emit("prediction", prediction);
  }
}

/**
 * Parse a Hermes inner pubsub message into `UnifiedPrediction`. Returns null
 * when the payload shape doesn't match (defensive — we don't want a malformed
 * frame to crash the listener).
 *
 * Exported for unit testing.
 */
export function parsePredictionEvent(
  inner: unknown,
  _channelId: string,
): UnifiedPrediction | null {
  if (!isObject(inner)) return null;
  const data = isObject(inner.data) ? inner.data : null;
  const event = data && isObject(data.event) ? data.event : null;
  if (!event) return null;

  const id = typeof event.id === "string" ? event.id : null;
  const title = typeof event.title === "string" ? event.title : null;
  const statusRaw = typeof event.status === "string" ? event.status : "";
  if (!id || !title || !VALID_STATUSES.has(statusRaw)) return null;
  const status = statusRaw as Status;

  const outcomesRaw = Array.isArray(event.outcomes) ? event.outcomes : [];
  const outcomes: UnifiedPredictionOutcome[] = outcomesRaw
    .map((o) => parseOutcome(o))
    .filter((o): o is UnifiedPredictionOutcome => o !== null);

  if (outcomes.length === 0) return null;

  const windowSeconds =
    typeof event.prediction_window_seconds === "number"
      ? event.prediction_window_seconds
      : null;
  const winningOutcomeId =
    typeof event.winning_outcome_id === "string" && event.winning_outcome_id.length > 0
      ? event.winning_outcome_id
      : null;
  const endedAt = typeof event.ended_at === "string" && event.ended_at.length > 0
    ? event.ended_at
    : null;

  return {
    id,
    platform: "twitch",
    title,
    status,
    outcomes,
    winningOutcomeId,
    predictionWindowSeconds: windowSeconds,
    endedAt,
    viewerOutcomeId: null,
    viewerStake: null,
  };
}

function parseOutcome(raw: unknown): UnifiedPredictionOutcome | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  const title = typeof raw.title === "string" ? raw.title : null;
  if (!id || !title) return null;
  const totalAmount = typeof raw.total_points === "number" ? raw.total_points : 0;
  const userCount = typeof raw.total_users === "number" ? raw.total_users : 0;
  const colorRaw = typeof raw.color === "string" ? raw.color.toLowerCase() : null;
  const color = colorRaw && VALID_COLORS.has(colorRaw)
    ? (colorRaw as UnifiedPredictionOutcome["color"])
    : null;
  const topPredictorsRaw = Array.isArray(raw.top_predictors) ? raw.top_predictors : null;
  const topPredictors = topPredictorsRaw
    ? topPredictorsRaw
        .map((tp): UnifiedPredictionOutcome["topPredictors"] extends Array<infer U> | undefined ? U : never => {
          if (!isObject(tp)) return null as never;
          const userId = typeof tp.user_id === "string" ? tp.user_id : null;
          const userName =
            typeof tp.user_display_name === "string"
              ? tp.user_display_name
              : typeof tp.user_login === "string"
                ? tp.user_login
                : null;
          const amount = typeof tp.points === "number" ? tp.points : null;
          if (!userId || !userName || amount === null) return null as never;
          return { userId, userName, amount };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null && (x as unknown) !== undefined)
    : undefined;
  return {
    id,
    title,
    color,
    totalAmount,
    userCount,
    ...(topPredictors && topPredictors.length > 0 ? { topPredictors } : {}),
  };
}

const VALID_COLORS: ReadonlySet<string> = new Set([
  "blue",
  "pink",
  "yellow",
  "green",
  "orange",
  "purple",
  "red",
  "cyan",
  "brown",
  "gray",
]);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function makeId(): string {
  // Xtra uses a 21-char id from a stripped UUID. Random alphanumeric works
  // equivalently for our purposes — the id only has to be unique within the
  // single WebSocket connection's lifetime.
  let s = "";
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 21; i += 1) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}
