import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pusher-js is loaded at module-init time by kick-chat.ts but only used inside
// connect() / joinChannel(). These tests bypass those paths by stubbing the
// module-level getKickPusher accessor with a fake pusher object, so a no-op
// mock at import time is enough.
vi.mock("pusher-js", () => ({
  default: vi.fn(),
}));

import { kickChatService, getKickPusher } from "@/backend/services/chat/kick-chat";
import { kickPredictionsService } from "@/backend/services/chat/kick-predictions-service";
import * as kickPredictionsApi from "@/backend/api/platforms/kick/kick-predictions";
import type { KickPredictionPayload } from "@/backend/api/platforms/kick/kick-types";
import type { UnifiedPrediction } from "@/shared/chat-types";

// Guards: U1 acquire/release lifecycle, REST seed emit, Pusher event binding,
// anonymous-vs-authed subscription posture, channel-id correctness on the
// emitted UnifiedPrediction, idempotent acquire while Pusher is disconnected
// (queue → flush on connectionStateChange), release tearing down the Pusher
// channel.

interface FakeChannelHandle {
  channelName: string;
  bindings: Map<string, Set<(data: unknown) => void>>;
  bind: (event: string, cb: (data: unknown) => void) => void;
  unbind_all: () => void;
  emit: (event: string, data: unknown) => void;
}

interface FakePusher {
  connection: {
    state: string;
    connection?: {
      transport?: {
        state?: string;
        socket?: { readyState?: number };
      };
    };
  };
  channels: Map<string, FakeChannelHandle>;
  subscribe: (channelName: string) => FakeChannelHandle;
  unsubscribe: (channelName: string) => void;
}

function makeFakeChannel(channelName: string): FakeChannelHandle {
  const bindings = new Map<string, Set<(data: unknown) => void>>();
  return {
    channelName,
    bindings,
    bind(event, cb) {
      let set = bindings.get(event);
      if (!set) {
        set = new Set();
        bindings.set(event, set);
      }
      set.add(cb);
    },
    unbind_all() {
      bindings.clear();
    },
    emit(event, data) {
      const set = bindings.get(event);
      if (!set) return;
      for (const cb of set) cb(data);
    },
  };
}

function makeFakePusher(initialState: string = "connected"): FakePusher {
  const channels = new Map<string, FakeChannelHandle>();
  return {
    connection: { state: initialState },
    channels,
    subscribe(channelName) {
      const existing = channels.get(channelName);
      if (existing) return existing;
      const handle = makeFakeChannel(channelName);
      channels.set(channelName, handle);
      return handle;
    },
    unsubscribe(channelName) {
      channels.delete(channelName);
    },
  };
}

function makeRawPrediction(
  overrides: Partial<KickPredictionPayload> = {},
): KickPredictionPayload {
  return {
    id: "pred-1",
    title: "Will Ramee win?",
    state: "ACTIVE",
    outcomes: [
      { id: "o1", title: "Yes", total_vote_amount: 1000 },
      { id: "o2", title: "No", total_vote_amount: 500 },
    ],
    duration: 120,
    created_at: "2026-05-22T19:00:00.000Z",
    ...overrides,
  };
}

let fakePusher: FakePusher;
let pusherSpy: ReturnType<typeof vi.spyOn>;
let getLatestSpy: ReturnType<typeof vi.spyOn>;
let emittedPredictions: UnifiedPrediction[];
let predictionEmitterHandler: (p: UnifiedPrediction) => void;

beforeEach(() => {
  fakePusher = makeFakePusher("connected");
  const chatInternals = kickChatService as unknown as { getPusher(): FakePusher };
  pusherSpy = vi
    .spyOn(
      chatInternals,
      "getPusher",
    )
    .mockImplementation(() => fakePusher);
  getLatestSpy = vi
    .spyOn(kickPredictionsApi, "getLatestPrediction")
    .mockResolvedValue({ ok: true, payload: null });
  emittedPredictions = [];
  predictionEmitterHandler = (p: UnifiedPrediction) => {
    emittedPredictions.push(p);
  };
  kickChatService.on("predictionUpdate", predictionEmitterHandler);
});

afterEach(() => {
  kickChatService.off("predictionUpdate", predictionEmitterHandler);
  kickPredictionsService.__resetForTesting();
  pusherSpy.mockRestore();
  getLatestSpy.mockRestore();
});

describe("kickPredictionsService.acquire (REST seed path)", () => {
  it("fires the REST seed against the supplied slug and emits when payload is non-null", async () => {
    getLatestSpy.mockResolvedValueOnce({
      ok: true,
      payload: makeRawPrediction(),
    });

    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    // Allow the queued REST microtask + emit to flush.
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(getLatestSpy).toHaveBeenCalledWith("ramee", { accessToken: undefined });
    expect(emittedPredictions).toHaveLength(1);
    expect(emittedPredictions[0].id).toBe("pred-1");
    expect(emittedPredictions[0].channelId).toBe("12345");
    expect(emittedPredictions[0].channelSlug).toBe("ramee");
    expect(emittedPredictions[0].platform).toBe("kick");
  });

  it("forwards the accessToken to the REST call when supplied", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
      accessToken: "tok-abc",
    });

    expect(getLatestSpy).toHaveBeenCalledWith("ramee", { accessToken: "tok-abc" });
  });

  it("does NOT emit when the REST seed returns ok:true with null payload (no active prediction)", async () => {
    getLatestSpy.mockResolvedValueOnce({ ok: true, payload: null });

    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(emittedPredictions).toHaveLength(0);
  });

  it("does NOT emit when the REST seed returns an error result", async () => {
    getLatestSpy.mockResolvedValueOnce({
      ok: false,
      kind: "network",
      message: "timeout",
    });

    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(emittedPredictions).toHaveLength(0);
  });
});

describe("kickPredictionsService.acquire (Pusher subscription path)", () => {
  it("subscribes to predictions-channel-{channelId} when Pusher is already connected", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(true);
  });

  it("emits a normalized predictionUpdate when PredictionCreated fires on the Pusher channel", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    const channel = fakePusher.channels.get("predictions-channel-12345");
    expect(channel).toBeDefined();

    channel?.emit("PredictionCreated", { prediction: makeRawPrediction() });

    // Drop the REST seed emit (also fires with our default mock if non-null).
    // Default mock returns null, so the only emit comes from the Pusher event.
    expect(emittedPredictions).toHaveLength(1);
    expect(emittedPredictions[0].id).toBe("pred-1");
    expect(emittedPredictions[0].channelId).toBe("12345");
    expect(emittedPredictions[0].channelSlug).toBe("ramee");
  });

  it("emits a normalized predictionUpdate when PredictionUpdated fires (status transition)", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    const channel = fakePusher.channels.get("predictions-channel-12345");
    channel?.emit("PredictionUpdated", {
      prediction: makeRawPrediction({
        state: "RESOLVED",
        winning_outcome_id: "o1",
      }),
    });

    expect(emittedPredictions).toHaveLength(1);
    expect(emittedPredictions[0].status).toBe("RESOLVED");
    expect(emittedPredictions[0].winningOutcomeId).toBe("o1");
  });

  it("uses PLAIN event names (no `App\\Events\\` prefix per discovery)", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    const channel = fakePusher.channels.get("predictions-channel-12345");
    // Negative assertion — verify that the App\Events\ namespaced variants
    // are NOT bound. Drift on this would mean predictions stop arriving.
    expect(channel?.bindings.has("App\\Events\\PredictionCreated")).toBe(false);
    expect(channel?.bindings.has("App\\Events\\PredictionUpdated")).toBe(false);
    // And confirm the plain names are bound.
    expect(channel?.bindings.has("PredictionCreated")).toBe(true);
    expect(channel?.bindings.has("PredictionUpdated")).toBe(true);
  });

  it("ignores Pusher events with a malformed payload (missing prediction.id)", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    const channel = fakePusher.channels.get("predictions-channel-12345");
    channel?.emit("PredictionCreated", { prediction: null });
    channel?.emit("PredictionCreated", {});
    channel?.emit("PredictionCreated", { prediction: { title: "no id" } });

    expect(emittedPredictions).toHaveLength(0);
  });
});

describe("kickPredictionsService.acquire (deferred subscription when disconnected)", () => {
  it("queues the subscription when Pusher is disconnected and flushes on connectionStateChange to connected", async () => {
    // Start disconnected.
    fakePusher.connection.state = "disconnected";

    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    // No subscription yet.
    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(false);

    // Flip to connected and emit the connection-state event.
    fakePusher.connection.state = "connected";
    kickChatService.emit("connectionStateChange", {
      platform: "kick",
      state: "connected",
      channels: [],
      isAuthenticated: false,
    });

    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(true);
  });
});

describe("kickPredictionsService anonymous-then-authed fallback", () => {
  it("tears down the anonymous subscription on pusher:subscription_error and stops retrying without a token", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    const channel = fakePusher.channels.get("predictions-channel-12345");
    channel?.emit("pusher:subscription_error", { type: "AuthError" });

    // Subscription tore down — channel removed from the fake's map.
    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(false);
  });

  it("emits a warning at most once after the authed retry fails (per-channel guard)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await kickPredictionsService.acquire({
        channelId: "12345",
        channelSlug: "ramee",
        accessToken: "tok-abc",
      });

      // First failure — marks authedRetryAttempted but doesn't warn yet (
      // the service treats the first error as the "anonymous attempt failed,
      // await authed reconnect" branch).
      const channel = fakePusher.channels.get("predictions-channel-12345");
      channel?.emit("pusher:subscription_error", { type: "AuthError" });

      // Re-acquire to force a fresh subscription attempt under "authed" flag.
      await kickPredictionsService.acquire({
        channelId: "12345",
        channelSlug: "ramee",
        accessToken: "tok-abc",
      });
      const channel2 = fakePusher.channels.get("predictions-channel-12345");
      // Second subscription_error fires under authedRetryAttempted=true — warns.
      channel2?.emit("pusher:subscription_error", { type: "AuthError" });
      // Third one same channel — should NOT warn again.
      channel2?.emit("pusher:subscription_error", { type: "AuthError" });

      // Warn at most once.
      expect(warnSpy.mock.calls.length).toBeLessThanOrEqual(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("kickPredictionsService.release", () => {
  it("unsubscribes from the Pusher channel when the ref count drops to zero", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(true);

    kickPredictionsService.release({ channelId: "12345" });

    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(false);
    expect(kickPredictionsService.__getActiveChannelIds()).not.toContain("12345");
  });

  it("does NOT unsubscribe while additional references remain (ref-counted multiview)", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    kickPredictionsService.release({ channelId: "12345" });

    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(true);
    expect(kickPredictionsService.__getActiveChannelIds()).toContain("12345");
  });

  it("is a no-op when called for an unknown channelId", () => {
    expect(() =>
      kickPredictionsService.release({ channelId: "unknown" }),
    ).not.toThrow();
  });

  it("is a no-op when called with an empty channelId", () => {
    expect(() =>
      kickPredictionsService.release({ channelId: "" }),
    ).not.toThrow();
  });
});

describe("kickPredictionsService.acquire idempotency", () => {
  it("does not double-subscribe when acquire fires repeatedly for the same channel", async () => {
    const subscribeSpy = vi.spyOn(fakePusher, "subscribe");

    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });

    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(subscribeSpy).toHaveBeenCalledWith("predictions-channel-12345");
  });

  it("is a no-op when called with an empty channelId", async () => {
    await kickPredictionsService.acquire({
      channelId: "",
      channelSlug: "ramee",
    });
    expect(getLatestSpy).not.toHaveBeenCalled();
    expect(fakePusher.channels.size).toBe(0);
  });
});

describe("getKickPusher accessor", () => {
  it("returns the value of kickChatService.getPusher()", () => {
    // The spyOn in beforeEach replaces getPusher to return the fake. The
    // module-level getKickPusher() must surface that value unchanged so
    // sibling services can use a single import point.
    expect(getKickPusher()).toBe(fakePusher);
  });
});

describe("kickPredictionsService teardown does not race the Pusher socket close", () => {
  // Guards: release() must skip pusher.unsubscribe() when the Pusher socket is
  // no longer in 'connected' state — the unsubscribe frame races concurrent
  // disconnect()/forceShutdown() in kick-chat and triggers pusher-js
  // "WebSocket is already in CLOSING or CLOSED state". Same class as the
  // kick-chat teardown race fixed in 22f575f; predictions has its own
  // pusher.unsubscribe call sites at unsubscribe(entry) line and the
  // anonymous-failure cleanup branch.
  // Guards: KickChat final-view cleanup can explicitly skip prediction
  // unsubscribe frames because the shared Pusher socket is about to close.
  // Guards: release() must also skip pusher.unsubscribe() when Pusher's public
  // state still says connected but the raw WebSocket is already CLOSING/CLOSED.

  it("release(channelId) does NOT call pusher.unsubscribe when the socket is already disconnected", async () => {
    // Subscribe while connected so the entry has a pusherChannel.
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(true);

    // The chat-service's pusher just got disconnected (e.g. user closed the
    // tab, switched platforms, or main.before-quit fired).
    fakePusher.connection.state = "disconnected";

    const unsubSpy = vi.spyOn(fakePusher, "unsubscribe");
    kickPredictionsService.release({ channelId: "12345" });

    expect(unsubSpy).not.toHaveBeenCalled();
  });

  it("release(channelId) does NOT call pusher.unsubscribe when KickChat is about to close the shared socket", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(true);

    const unsubSpy = vi.spyOn(fakePusher, "unsubscribe");
    kickPredictionsService.release({
      channelId: "12345",
      skipPusherUnsubscribe: true,
    });

    expect(unsubSpy).not.toHaveBeenCalled();
  });

  it("release(channelId) does NOT call pusher.unsubscribe when Pusher still says connected but the raw socket is closing", async () => {
    await kickPredictionsService.acquire({
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(fakePusher.channels.has("predictions-channel-12345")).toBe(true);
    fakePusher.connection.connection = {
      transport: {
        state: "open",
        socket: { readyState: 2 },
      },
    };

    const unsubSpy = vi.spyOn(fakePusher, "unsubscribe");
    kickPredictionsService.release({ channelId: "12345" });

    expect(unsubSpy).not.toHaveBeenCalled();
  });
});
