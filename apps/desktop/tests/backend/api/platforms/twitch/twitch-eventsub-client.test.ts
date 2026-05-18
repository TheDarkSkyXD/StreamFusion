/**
 * Tests for the Twitch EventSub WebSocket client (U8).
 *
 * Strategy:
 *   - Stub `WebSocket` via the `webSocketCtor` option so we can drive
 *     open / message / close events from tests.
 *   - Stub `fetch` to capture Helix subscription POST/DELETE calls and
 *     return canned responses with subscription ids.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetTwitchEventSubClientsForTesting,
  getTwitchEventSubClient,
} from "@/backend/api/platforms/twitch/twitch-eventsub-client";
import type {
  NotificationPayload,
  TwitchEventSubConnectionState,
} from "@/backend/api/platforms/twitch/twitch-eventsub-types";

// ---------------------------------------------------------------------------
// MockWebSocket
// ---------------------------------------------------------------------------

interface MockWebSocketLike {
  url: string;
  readyState: number;
  sent: string[];
  closed: boolean;
  closeCode: number | null;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  _open(): void;
  _emit(envelope: unknown): void;
  _serverClose(code?: number): void;
}

class MockWebSocket implements MockWebSocketLike {
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  closeCode: number | null = null;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, _reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCode = code ?? 1000;
    this.readyState = 3;
    // Fire close async-ish so the swap path on session_reconnect lines up.
    queueMicrotask(() => {
      this.onclose?.({ code: this.closeCode ?? 1000 } as CloseEvent);
    });
  }
  _open(): void {
    this.readyState = 1;
    this.onopen?.({} as Event);
  }
  _emit(envelope: unknown): void {
    this.onmessage?.({ data: JSON.stringify(envelope) } as MessageEvent);
  }
  _serverClose(code = 1006): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCode = code;
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = "tok-1";
const SELF_ID = "self-99";
const WS_URL = "wss://test.eventsub.local/ws";

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

let fetchCalls: FetchCall[] = [];
let nextPostId = 0;
let fetchOverride: ((call: FetchCall) => Response) | null = null;

function installFetch(): void {
  fetchCalls = [];
  nextPostId = 0;
  fetchOverride = null;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = (init?.method as string) ?? "GET";
    const headers = (init?.headers as Record<string, string>) ?? {};
    const rawBody = init?.body;
    let body: unknown = null;
    if (typeof rawBody === "string") {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    const call: FetchCall = { url, method, body, headers };
    fetchCalls.push(call);

    if (fetchOverride) {
      return fetchOverride(call);
    }

    if (method === "POST") {
      nextPostId += 1;
      const id = `sub-${nextPostId}`;
      return new Response(JSON.stringify({ data: [{ id }] }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 200 });
  });
}

function welcomeEnvelope(sessionId = "sess-1", keepalive = 10) {
  return {
    metadata: {
      message_id: "welcome-msg",
      message_type: "session_welcome",
      message_timestamp: "2026-05-18T00:00:00Z",
    },
    payload: {
      session: {
        id: sessionId,
        status: "connected",
        keepalive_timeout_seconds: keepalive,
        reconnect_url: null,
        connected_at: "2026-05-18T00:00:00Z",
      },
    },
  };
}

function reconnectEnvelope(reconnectUrl: string, sessionId = "sess-1") {
  return {
    metadata: {
      message_id: "reconnect-msg",
      message_type: "session_reconnect",
      message_timestamp: "2026-05-18T00:00:00Z",
    },
    payload: {
      session: {
        id: sessionId,
        status: "reconnecting",
        keepalive_timeout_seconds: null,
        reconnect_url: reconnectUrl,
        connected_at: "2026-05-18T00:00:00Z",
      },
    },
  };
}

function notificationEnvelope(
  subscriptionId: string,
  type: "channel.moderate",
  channelId: string,
  event: Record<string, unknown>,
) {
  return {
    metadata: {
      message_id: `notif-${subscriptionId}`,
      message_type: "notification",
      message_timestamp: "2026-05-18T00:00:00Z",
      subscription_type: type,
      subscription_version: "2",
    },
    payload: {
      subscription: {
        id: subscriptionId,
        type,
        version: "2",
        status: "enabled",
        cost: 0,
        condition: { broadcaster_user_id: channelId, moderator_user_id: SELF_ID },
        transport: { method: "websocket", session_id: "sess-1" },
        created_at: "2026-05-18T00:00:00Z",
      },
      event,
    },
  };
}

function revocationEnvelope(
  subscriptionId: string,
  type: "channel.moderate",
  channelId: string,
) {
  return {
    metadata: {
      message_id: `revoke-${subscriptionId}`,
      message_type: "revocation",
      message_timestamp: "2026-05-18T00:00:00Z",
    },
    payload: {
      subscription: {
        id: subscriptionId,
        type,
        version: "2",
        status: "user_removed",
        cost: 0,
        condition: { broadcaster_user_id: channelId, moderator_user_id: SELF_ID },
        transport: { method: "websocket", session_id: "sess-1" },
        created_at: "2026-05-18T00:00:00Z",
      },
    },
  };
}

function getClient(opts?: { url?: string }) {
  return getTwitchEventSubClient(TOKEN, SELF_ID, {
    wsEndpoint: opts?.url ?? WS_URL,
    webSocketCtor: MockWebSocket as unknown as typeof WebSocket,
  });
}

async function flushMicrotasks() {
  // Three microtask flushes is enough for our async POST handler + state
  // emission chain.
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockWebSocket.instances = [];
  installFetch();
});

afterEach(() => {
  __resetTwitchEventSubClientsForTesting();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TwitchEventSubClient — connection + subscription lifecycle", () => {
  it("first subscribe opens the WS and waits for session_welcome before POSTing", async () => {
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toBe(WS_URL);
    ws._open();
    await flushMicrotasks();
    expect(fetchCalls).toHaveLength(0);

    ws._emit(welcomeEnvelope("sess-1", 10));
    await flushMicrotasks();
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.method).toBe("POST");
  });

  it("session_welcome triggers a Helix POST with the correct body", async () => {
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope("sess-abc", 10));
    await flushMicrotasks();

    expect(fetchCalls).toHaveLength(1);
    const call = fetchCalls[0]!;
    expect(call.url).toBe("https://api.twitch.tv/helix/eventsub/subscriptions");
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({
      type: "channel.moderate",
      version: "2",
      condition: { broadcaster_user_id: "chan-1", moderator_user_id: SELF_ID },
      transport: { method: "websocket", session_id: "sess-abc" },
    });
    expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.headers["Client-Id"]).toBeTruthy();
  });

  it("multiple subscribers to the same (eventType, channelId) reuse one upstream sub", async () => {
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});
    client.subscribe("channel.moderate", "chan-1", () => {});
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope());
    await flushMicrotasks();

    const posts = fetchCalls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("distinct (eventType, channelId) pairs each generate their own POST", async () => {
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});
    client.subscribe("channel.moderate", "chan-2", () => {});
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope());
    await flushMicrotasks();

    const posts = fetchCalls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(2);
  });

  it("last-unsubscribe fires a Helix DELETE for the subscription id", async () => {
    const client = getClient();
    const unsubA = client.subscribe("channel.moderate", "chan-1", () => {});
    const unsubB = client.subscribe("channel.moderate", "chan-1", () => {});
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope());
    await flushMicrotasks();

    // First unsub does NOT fire DELETE.
    unsubA();
    await flushMicrotasks();
    expect(fetchCalls.filter((c) => c.method === "DELETE")).toHaveLength(0);

    // Last unsub does fire DELETE for sub-1.
    unsubB();
    await flushMicrotasks();
    const deletes = fetchCalls.filter((c) => c.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.url).toContain("id=sub-1");
  });

  it("no-more-listeners closes the WS", async () => {
    const client = getClient();
    const unsub = client.subscribe("channel.moderate", "chan-1", () => {});
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope());
    await flushMicrotasks();

    expect(ws.closed).toBe(false);
    unsub();
    await flushMicrotasks();
    expect(ws.closed).toBe(true);
    expect(client.connectionState).toBe("idle");
  });
});

describe("TwitchEventSubClient — reconnect", () => {
  it("session_reconnect opens a new WS to the supplied URL and closes the old one", async () => {
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});
    const oldWs = MockWebSocket.instances[0]!;
    oldWs._open();
    oldWs._emit(welcomeEnvelope("sess-1"));
    await flushMicrotasks();

    const RECONNECT_URL = "wss://test.eventsub.local/ws?reconnect=1";
    oldWs._emit(reconnectEnvelope(RECONNECT_URL, "sess-1"));
    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(2);
    const newWs = MockWebSocket.instances[1]!;
    expect(newWs.url).toBe(RECONNECT_URL);
    // Old WS was closed pre-emptively.
    expect(oldWs.closed).toBe(true);

    newWs._open();
    newWs._emit(welcomeEnvelope("sess-2"));
    await flushMicrotasks();
    expect(client.connectionState).toBe("connected");

    // No new Helix POST issued — Twitch retains subs across the swap.
    const posts = fetchCalls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
  });

  it("keepalive timeout (no message within 1.5×keepalive_seconds) forces a reconnect attempt", async () => {
    vi.useFakeTimers();
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope("sess-1", 10)); // 10s → 15s grace
    await vi.advanceTimersByTimeAsync(0); // flush microtasks
    expect(MockWebSocket.instances).toHaveLength(1);

    // Just under 15s — still alive.
    await vi.advanceTimersByTimeAsync(14_000);
    expect(client.connectionState).toBe("connected");

    // Crossing 15s — keepalive guard fires; force-reconnect path schedules
    // a fresh open after the first backoff (250ms).
    await vi.advanceTimersByTimeAsync(1_001);
    expect(client.connectionState).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(260);
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  it("abnormal close triggers exponential-backoff reconnect (250ms → 500ms → …)", async () => {
    vi.useFakeTimers();
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});
    const ws1 = MockWebSocket.instances[0]!;
    ws1._open();
    ws1._emit(welcomeEnvelope());
    await vi.advanceTimersByTimeAsync(0);

    // Abnormal close — server-initiated.
    ws1._serverClose(1006);
    expect(client.connectionState).toBe("reconnecting");

    // Just before 250ms — no new socket yet.
    await vi.advanceTimersByTimeAsync(249);
    expect(MockWebSocket.instances).toHaveLength(1);
    // At 250ms — second socket opens.
    await vi.advanceTimersByTimeAsync(2);
    expect(MockWebSocket.instances).toHaveLength(2);

    const ws2 = MockWebSocket.instances[1]!;
    ws2._open();
    ws2._serverClose(1006);

    // Backoff doubles to 500ms.
    await vi.advanceTimersByTimeAsync(499);
    expect(MockWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("circuit-breaker: after 10 failed reconnects, state becomes 'error' and no further reconnects fire", async () => {
    vi.useFakeTimers();
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});

    // Drive 10 failed connections.
    for (let i = 0; i < 10; i += 1) {
      const ws = MockWebSocket.instances[i]!;
      ws._open();
      ws._serverClose(1006);
      // Advance by the current backoff (cap at 8s).
      const exponent = Math.min(i, 6);
      const delay = Math.min(250 * 2 ** exponent, 8000);
      await vi.advanceTimersByTimeAsync(delay + 10);
    }

    // After 10 close-driven scheduleReconnects we should have opened 11
    // sockets total (the initial + 10 reconnects). The 11th open just
    // happened; close it and the next scheduleReconnect trips the
    // circuit-breaker (attempts already at 10 → 10 >= MAX → error).
    expect(MockWebSocket.instances).toHaveLength(11);
    const lastWs = MockWebSocket.instances[10]!;
    lastWs._open();
    lastWs._serverClose(1006);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.connectionState).toBe("error");
    expect(MockWebSocket.instances).toHaveLength(11);
  });
});

describe("TwitchEventSubClient — dispatch + observability", () => {
  it("notifications dispatch only to listeners for the matching (type, channel)", async () => {
    const client = getClient();
    const a = vi.fn();
    const b = vi.fn();
    client.subscribe<Record<string, unknown>>("channel.moderate", "chan-1", a);
    client.subscribe<Record<string, unknown>>("channel.moderate", "chan-2", b);
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope());
    await flushMicrotasks();

    // POSTs return sub-1, sub-2 in the order subscribe was called.
    ws._emit(
      notificationEnvelope("sub-1", "channel.moderate", "chan-1", { kind: "ban" }),
    );
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    const arg = a.mock.calls[0]![0] as NotificationPayload<{ kind: string }>;
    expect(arg.event).toEqual({ kind: "ban" });
  });

  it("revocation drops local tracking so a fresh subscribe re-POSTs", async () => {
    const client = getClient();
    const unsub = client.subscribe("channel.moderate", "chan-1", () => {});
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope());
    await flushMicrotasks();
    expect(fetchCalls.filter((c) => c.method === "POST")).toHaveLength(1);

    ws._emit(revocationEnvelope("sub-1", "channel.moderate", "chan-1"));
    await flushMicrotasks();

    // Drop the original listener so we hit a clean refcount path, then resub.
    unsub();
    await flushMicrotasks();
    // The unsub fired a DELETE for the dropped local id — but since revocation
    // already cleared the subscriptionId, no DELETE goes out.
    const deletesAfterRevoke = fetchCalls.filter((c) => c.method === "DELETE");
    expect(deletesAfterRevoke).toHaveLength(0);

    // After unsub the WS closed; resubscribing opens a fresh socket.
    client.subscribe("channel.moderate", "chan-1", () => {});
    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws2._open();
    ws2._emit(welcomeEnvelope());
    await flushMicrotasks();
    const posts = fetchCalls.filter((c) => c.method === "POST");
    expect(posts.length).toBeGreaterThanOrEqual(2);
  });

  it("onConnectionStateChange emits the state transitions", async () => {
    const client = getClient();
    const states: TwitchEventSubConnectionState[] = [];
    client.onConnectionStateChange((s) => {
      states.push(s);
    });
    client.subscribe("channel.moderate", "chan-1", () => {});
    expect(states).toContain("connecting");

    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope());
    await flushMicrotasks();
    expect(states).toContain("connected");

    const RECONNECT_URL = "wss://test.eventsub.local/ws?r=1";
    ws._emit(reconnectEnvelope(RECONNECT_URL));
    await flushMicrotasks();
    expect(states).toContain("reconnecting");

    const ws2 = MockWebSocket.instances[1]!;
    ws2._open();
    ws2._emit(welcomeEnvelope("sess-2"));
    await flushMicrotasks();
    // We re-emit "connected" after the swap.
    expect(states[states.length - 1]).toBe("connected");
  });

  it("close() is idempotent and DELETEs all active subscriptions", async () => {
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});
    client.subscribe("channel.moderate", "chan-2", () => {});
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope());
    await flushMicrotasks();

    client.close();
    await flushMicrotasks();
    const firstDeletes = fetchCalls.filter((c) => c.method === "DELETE").length;
    expect(firstDeletes).toBe(2);
    expect(ws.closed).toBe(true);

    // Second close: idempotent — no extra DELETEs.
    client.close();
    await flushMicrotasks();
    const secondDeletes = fetchCalls.filter((c) => c.method === "DELETE").length;
    expect(secondDeletes).toBe(2);
  });

  it("getTwitchEventSubClient memoizes by (accessToken, broadcasterUserId)", () => {
    const a = getClient();
    const b = getClient();
    expect(a).toBe(b);
    const other = getTwitchEventSubClient(TOKEN, "other-self", {
      wsEndpoint: WS_URL,
      webSocketCtor: MockWebSocket as unknown as typeof WebSocket,
    });
    expect(other).not.toBe(a);
  });

  it("unknown message_type is logged but does not crash dispatch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = getClient();
    client.subscribe("channel.moderate", "chan-1", () => {});
    const ws = MockWebSocket.instances[0]!;
    ws._open();
    ws._emit(welcomeEnvelope());
    await flushMicrotasks();

    ws._emit({
      metadata: { message_id: "x", message_type: "unknown_type", message_timestamp: "" },
      payload: {},
    });
    await flushMicrotasks();
    expect(warn).toHaveBeenCalled();
    expect(client.connectionState).toBe("connected");
    warn.mockRestore();
  });
});
