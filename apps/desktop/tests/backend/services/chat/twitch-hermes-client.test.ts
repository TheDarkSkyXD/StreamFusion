import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parsePredictionEvent,
  TwitchHermesClient,
} from "@/backend/services/chat/twitch-hermes-client";

// Guards: Hermes prediction-event parsing — `data.event` shape, ACTIVE/RESOLVED/CANCELED/LOCKED status set, BLUE/PINK color literals, and the top_predictors array under outcomes. Hermes drift on any of these would silently break the prediction banner.
// Guards: multiview-bus channel-id threading — `parsePredictionEvent(payload, channelId)` must stamp the channelId onto the result so a singleton Hermes connection emitting to N subscribers doesn't bleed channel A's prediction into channel B's banner.
// Guards: anonymous Hermes envelope — `viewerOutcomeId` and `viewerStake` are always null off the public bus; only authed Helix surfaces would carry them. A change that defaults them non-null silently breaks the "have I bet?" UI gate.

const CHANNEL_ID = "12345";

function activePayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    data: {
      event: {
        id: "pred-1",
        created_at: "2026-05-18T22:00:00Z",
        title: "Who wins next game?",
        status: "ACTIVE",
        prediction_window_seconds: 120,
        winning_outcome_id: null,
        outcomes: [
          {
            id: "outcome-a",
            title: "Sodapoppin",
            total_points: 979_100,
            total_users: 1245,
            color: "BLUE",
          },
          {
            id: "outcome-b",
            title: "EggsQc",
            total_points: 848_900,
            total_users: 980,
            color: "PINK",
          },
        ],
        ...overrides,
      },
    },
  };
}

describe("parsePredictionEvent (Hermes payload → UnifiedPrediction)", () => {
  it("parses an ACTIVE prediction with 2 outcomes and BLUE/PINK colors", () => {
    const result = parsePredictionEvent(activePayload(), CHANNEL_ID);
    expect(result).not.toBeNull();
    expect(result?.platform).toBe("twitch");
    expect(result?.channelId).toBe(CHANNEL_ID);
    expect(result?.status).toBe("ACTIVE");
    expect(result?.title).toBe("Who wins next game?");
    expect(result?.outcomes).toHaveLength(2);
    expect(result?.outcomes[0].color).toBe("blue");
    expect(result?.outcomes[1].color).toBe("pink");
    expect(result?.winningOutcomeId).toBeNull();
    expect(result?.predictionWindowSeconds).toBe(120);
  });

  it("threads channelId from the subscription onto the prediction (multiview guard)", () => {
    const result = parsePredictionEvent(activePayload(), "99999");
    expect(result?.channelId).toBe("99999");
  });

  it("parses a RESOLVED prediction with winning_outcome_id and ended_at", () => {
    const result = parsePredictionEvent(
      activePayload({
        status: "RESOLVED",
        winning_outcome_id: "outcome-a",
        ended_at: "2026-05-18T22:02:11Z",
      }),
      CHANNEL_ID,
    );
    expect(result?.status).toBe("RESOLVED");
    expect(result?.winningOutcomeId).toBe("outcome-a");
    expect(result?.endedAt).toBe("2026-05-18T22:02:11Z");
  });

  it("parses CANCELED status", () => {
    const result = parsePredictionEvent(
      activePayload({ status: "CANCELED" }),
      CHANNEL_ID,
    );
    expect(result?.status).toBe("CANCELED");
  });

  it("parses LOCKED status", () => {
    const result = parsePredictionEvent(
      activePayload({ status: "LOCKED" }),
      CHANNEL_ID,
    );
    expect(result?.status).toBe("LOCKED");
  });

  it("extracts top_predictors when present (Twitch-native ended-state surface)", () => {
    const result = parsePredictionEvent(
      activePayload({
        outcomes: [
          {
            id: "outcome-a",
            title: "Yes",
            total_points: 250_000,
            total_users: 44,
            color: "BLUE",
            top_predictors: [
              { user_id: "u1", user_display_name: "blackgio789", points: 50_000 },
              { user_id: "u2", user_login: "secondplace", points: 30_000 },
            ],
          },
          { id: "outcome-b", title: "No", total_points: 100_000, total_users: 20, color: "PINK" },
        ],
      }),
      CHANNEL_ID,
    );
    expect(result?.outcomes[0].topPredictors).toBeDefined();
    expect(result?.outcomes[0].topPredictors?.[0].userName).toBe("blackgio789");
    expect(result?.outcomes[0].topPredictors?.[1].userName).toBe("secondplace");
    expect(result?.outcomes[1].topPredictors).toBeUndefined();
  });

  it("supports multi-outcome sequential palette (3+ outcomes, future-proofing)", () => {
    const result = parsePredictionEvent(
      activePayload({
        outcomes: [
          { id: "o1", title: "A", total_points: 1, total_users: 1, color: "BLUE" },
          { id: "o2", title: "B", total_points: 1, total_users: 1, color: "PINK" },
          { id: "o3", title: "C", total_points: 1, total_users: 1, color: "YELLOW" },
          { id: "o4", title: "D", total_points: 1, total_users: 1, color: "GREEN" },
        ],
      }),
      CHANNEL_ID,
    );
    expect(result?.outcomes).toHaveLength(4);
    expect(result?.outcomes.map((o) => o.color)).toEqual([
      "blue",
      "pink",
      "yellow",
      "green",
    ]);
  });

  it("returns null when the inner payload is not an object", () => {
    expect(parsePredictionEvent(null, CHANNEL_ID)).toBeNull();
    expect(parsePredictionEvent("nope", CHANNEL_ID)).toBeNull();
    expect(parsePredictionEvent(42, CHANNEL_ID)).toBeNull();
  });

  it("returns null when data.event is missing", () => {
    expect(parsePredictionEvent({}, CHANNEL_ID)).toBeNull();
    expect(parsePredictionEvent({ data: {} }, CHANNEL_ID)).toBeNull();
  });

  it("returns null when status is not a recognized value", () => {
    const result = parsePredictionEvent(
      activePayload({ status: "WAT" }),
      CHANNEL_ID,
    );
    expect(result).toBeNull();
  });

  it("returns null when outcomes array is empty", () => {
    const result = parsePredictionEvent(
      activePayload({ outcomes: [] }),
      CHANNEL_ID,
    );
    expect(result).toBeNull();
  });

  it("drops outcomes missing id or title but keeps the rest", () => {
    const result = parsePredictionEvent(
      activePayload({
        outcomes: [
          { id: "good", title: "Good", total_points: 100, total_users: 5 },
          { id: "no-title", total_points: 50, total_users: 2 },
          { title: "no-id", total_points: 50, total_users: 2 },
        ],
      }),
      CHANNEL_ID,
    );
    expect(result?.outcomes).toHaveLength(1);
    expect(result?.outcomes[0].id).toBe("good");
  });

  it("defaults missing total_points / total_users to 0", () => {
    const result = parsePredictionEvent(
      activePayload({
        outcomes: [{ id: "x", title: "X" }],
      }),
      CHANNEL_ID,
    );
    expect(result?.outcomes[0].totalAmount).toBe(0);
    expect(result?.outcomes[0].userCount).toBe(0);
  });

  it("sets color=null when outcome has no color field (Kick parity / unknown variant)", () => {
    const result = parsePredictionEvent(
      activePayload({
        outcomes: [{ id: "x", title: "X", total_points: 1, total_users: 1 }],
      }),
      CHANNEL_ID,
    );
    expect(result?.outcomes[0].color).toBeNull();
  });

  it("treats viewer self-state (viewerOutcomeId/viewerStake) as null — Hermes anonymous", () => {
    const result = parsePredictionEvent(activePayload(), CHANNEL_ID);
    expect(result?.viewerOutcomeId).toBeNull();
    expect(result?.viewerStake).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MockWebSocket — minimal stub for stop()-during-CONNECTING coverage. Mirrors
// the shape used in twitch-eventsub-client.test.ts (including the
// queueMicrotask onclose dispatch so async-close ordering is the same as the
// real WebSocket spec); kept local because only the connect/close lifecycle
// is exercised here.
// ---------------------------------------------------------------------------

class MockWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  closeCallCount = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(_: string): void {}
  close(): void {
    this.closeCallCount += 1;
    this.readyState = MockWebSocket.CLOSED;
    // Real WebSocket dispatches close async; matching that here keeps
    // ordering honest for any future reconnect/swap test.
    queueMicrotask(() => {
      this.onclose?.({ code: 1000 } as CloseEvent);
    });
  }
  _open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({} as Event);
  }
  /** Simulate a failed handshake (browser fires onerror then onclose). */
  _failHandshake(): void {
    this.onerror?.({} as Event);
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code: 1006 } as CloseEvent);
  }
}

// Guards: stop() during CONNECTING — closing a WebSocket before the handshake completes triggers the browser's spec-required "WebSocket is closed before the connection is established" console error. Under React StrictMode dev double-invoke the mount-cleanup runs synchronously after the initial effect, so close() lands while readyState=0. The lifecycle tests assert close is deferred to onopen, that consumer state events stay coherent (only "disconnected" fires; no spurious "connected" after the deferred close), and that hung-handshake / CLOSING / CLOSED branches behave correctly.
describe("TwitchHermesClient lifecycle (start/stop)", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not call close() while the WebSocket is still CONNECTING — defers to onopen so the browser does not log 'closed before connection established'", () => {
    const client = new TwitchHermesClient("12345");
    const states: string[] = [];
    client.on("state", (s) => states.push(s));
    client.start();
    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.readyState).toBe(MockWebSocket.CONNECTING);

    client.stop();
    expect(ws.closeCallCount).toBe(0);
    // Handlers we no longer want events from are detached; onopen is now the
    // deferred-close lambda, not the production "state: connected" handler.
    expect(ws.onopen).not.toBeNull();
    expect(ws.onmessage).toBeNull();
    expect(ws.onclose).toBeNull();
    expect(states).toEqual(["connecting", "disconnected"]);

    // Handshake lands: deferred onopen closes the socket. Crucially, the
    // production "state: connected" handler must NOT fire — that's the
    // regression that bare `expect(onopen).not.toBeNull()` would not catch.
    ws._open();
    expect(ws.closeCallCount).toBe(1);
    expect(states).toEqual(["connecting", "disconnected"]);
  });

  it("releases the deferred-close closure when the handshake fails — onerror nulls onopen so the captured ws can be collected", () => {
    const client = new TwitchHermesClient("12345");
    client.start();
    const ws = MockWebSocket.instances[0];
    client.stop();
    // CONNECTING branch installed both the deferred-close onopen and the
    // failure-path onerror.
    expect(ws.onopen).not.toBeNull();
    expect(ws.onerror).not.toBeNull();

    // Browser path on hung/refused handshake: onerror fires, then the socket
    // closes. The onerror handler nulls onopen so the deferred-close lambda
    // doesn't keep the WebSocket reachable.
    ws._failHandshake();
    expect(ws.onopen).toBeNull();
    // No deferred close ever ran (the failure already tore the socket down).
    expect(ws.closeCallCount).toBe(0);
  });

  it("closes immediately when stop() is called after the socket is OPEN", () => {
    const client = new TwitchHermesClient("12345");
    client.start();
    const ws = MockWebSocket.instances[0];
    ws._open();
    expect(ws.readyState).toBe(MockWebSocket.OPEN);

    client.stop();
    expect(ws.closeCallCount).toBe(1);
  });

  it("does not re-call close() when the socket is already CLOSING", () => {
    const client = new TwitchHermesClient("12345");
    client.start();
    const ws = MockWebSocket.instances[0];
    ws.readyState = MockWebSocket.CLOSING;

    client.stop();
    // CLOSING branch nulls onopen and returns without invoking close().
    expect(ws.closeCallCount).toBe(0);
    expect(ws.onopen).toBeNull();
    expect(ws.onmessage).toBeNull();
    expect(ws.onclose).toBeNull();
  });

  it("does not re-call close() when the socket is already CLOSED", () => {
    const client = new TwitchHermesClient("12345");
    client.start();
    const ws = MockWebSocket.instances[0];
    ws.readyState = MockWebSocket.CLOSED;

    client.stop();
    expect(ws.closeCallCount).toBe(0);
    expect(ws.onopen).toBeNull();
  });
});
