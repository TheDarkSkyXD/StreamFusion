import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedPrediction } from "@/shared/chat-types";

// Guards: U3 5s polling loop — initial-fire on start, emit-on-change semantics
// (no re-emit on identical payload, re-emit on status / winning-outcome /
// tally diff), visibility pause (skips ticks when hidden), 401 → refresh +
// retry path through window.electronAPI.auth.getValidTwitchToken (renderer-safe
// auth seam — the poller must NEVER import twitchAuthService since that lives
// in the main process), two-consecutive-null auto-stop, three-auth-state
// matrix (guest → fetch without token → banner emits sans viewerOutcomeId;
// authed → fetch with token → self-state populated).

// vi.mock is hoisted to the top of the file by vitest. To reference
// top-level mock state from inside the factory, we use vi.hoisted() which
// runs BEFORE module imports — keeping the mock fn definition and its
// consumers in lockstep.
const { fetchChannelPredictionMock, chatServiceMock } = vi.hoisted(() => {
  return {
    fetchChannelPredictionMock: vi.fn<
      (login: string, opts?: { accessToken?: string }) => Promise<UnifiedPrediction | null>
    >(),
    chatServiceMock: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
  };
});

vi.mock("@/backend/services/chat/twitch-chat", () => ({
  twitchChatService: chatServiceMock,
}));

vi.mock("@/backend/api/platforms/twitch/twitch-gql-predictions", () => ({
  fetchChannelPrediction: fetchChannelPredictionMock,
}));

// Imports under test — after vi.mock so they pick up the stubs.
import {
  __resetTwitchPredictionPollers,
  startTwitchPredictionPolling,
  stopTwitchPredictionPolling,
} from "@/backend/services/chat/twitch-prediction-poller";

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

function activePrediction(overrides: Partial<UnifiedPrediction> = {}): UnifiedPrediction {
  return {
    id: "pred-1",
    platform: "twitch",
    channelId: "12345",
    channelSlug: "ramee",
    title: "Who wins?",
    status: "ACTIVE",
    outcomes: [
      { id: "outcome-a", title: "A", color: "blue", totalAmount: 100, userCount: 1 },
      { id: "outcome-b", title: "B", color: "pink", totalAmount: 200, userCount: 2 },
    ],
    winningOutcomeId: null,
    predictionWindowSeconds: 120,
    endedAt: null,
    viewerOutcomeId: null,
    viewerStake: null,
    ...overrides,
  };
}

// Helper — install a window.electronAPI shim. Tests that exercise the
// refresh path use a non-mocked getValidTwitchToken so we can spy.
function installElectronApi(
  getValidTwitchToken: () => Promise<string | null>,
): void {
  // biome-ignore lint/suspicious/noExplicitAny: jest-style window install
  const w = (globalThis as any).window ?? ((globalThis as any).window = {});
  w.electronAPI = {
    auth: { getValidTwitchToken: vi.fn(getValidTwitchToken) },
  };
}

function clearElectronApi(): void {
  // biome-ignore lint/suspicious/noExplicitAny: jest-style window install
  const w = (globalThis as any).window;
  if (w) delete w.electronAPI;
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchChannelPredictionMock.mockReset();
  chatServiceMock.emit.mockReset();
  chatServiceMock.on.mockReset();
  chatServiceMock.off.mockReset();
  // Default: no electronAPI shim — guest path. Individual tests install one
  // as needed.
  clearElectronApi();
  __resetTwitchPredictionPollers();
});

afterEach(() => {
  __resetTwitchPredictionPollers();
  vi.useRealTimers();
  clearElectronApi();
});

// Drives the queue of awaited promises until the bootstrap poll resolves.
// Generous loop covers retry chains where multiple awaits stack across
// fetchWithAuthRetry → getValidTwitchToken → second fetch.
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

// ------------------------------------------------------------
// Initial-fire and emit-on-change
// ------------------------------------------------------------

describe("startTwitchPredictionPolling — initial fetch", () => {
  it("fires the bootstrap fetch immediately on start (no 5s wait)", async () => {
    fetchChannelPredictionMock.mockResolvedValue(activePrediction());
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(1);
    expect(fetchChannelPredictionMock).toHaveBeenCalledWith("ramee", {
      accessToken: undefined,
    });
  });

  it("emits predictionUpdate on the first successful non-null response", async () => {
    fetchChannelPredictionMock.mockResolvedValue(activePrediction());
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    expect(chatServiceMock.emit).toHaveBeenCalledTimes(1);
    expect(chatServiceMock.emit).toHaveBeenCalledWith(
      "predictionUpdate",
      expect.objectContaining({ id: "pred-1", status: "ACTIVE", platform: "twitch" }),
    );
  });

  it("does not emit when the bootstrap fetch returns null (no active prediction)", async () => {
    fetchChannelPredictionMock.mockResolvedValue(null);
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    expect(chatServiceMock.emit).not.toHaveBeenCalled();
  });

  it("is idempotent — second start for the same login is a no-op", async () => {
    fetchChannelPredictionMock.mockResolvedValue(activePrediction());
    startTwitchPredictionPolling("ramee");
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    // Single bootstrap call regardless of the second start.
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(1);
  });
});

describe("emit-on-change semantics", () => {
  it("does NOT re-emit when the next tick returns an identical payload", async () => {
    fetchChannelPredictionMock.mockResolvedValue(activePrediction());
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    // Advance 5s — scheduled tick fires the fetch again.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(2);
    // But emit should only have fired once (initial).
    expect(chatServiceMock.emit).toHaveBeenCalledTimes(1);
  });

  it("emits again when status transitions (ACTIVE → LOCKED)", async () => {
    fetchChannelPredictionMock
      .mockResolvedValueOnce(activePrediction({ status: "ACTIVE" }))
      .mockResolvedValueOnce(activePrediction({ status: "LOCKED" }));
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chatServiceMock.emit).toHaveBeenCalledTimes(2);
    expect(chatServiceMock.emit.mock.calls[1][1]).toMatchObject({ status: "LOCKED" });
  });

  it("emits again when an outcome's totalAmount changes (material tally delta)", async () => {
    fetchChannelPredictionMock
      .mockResolvedValueOnce(activePrediction())
      .mockResolvedValueOnce(
        activePrediction({
          outcomes: [
            { id: "outcome-a", title: "A", color: "blue", totalAmount: 150, userCount: 1 },
            { id: "outcome-b", title: "B", color: "pink", totalAmount: 200, userCount: 2 },
          ],
        }),
      );
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chatServiceMock.emit).toHaveBeenCalledTimes(2);
  });

  it("emits again when winningOutcomeId changes (RESOLVED transition)", async () => {
    fetchChannelPredictionMock
      .mockResolvedValueOnce(activePrediction({ status: "LOCKED" }))
      .mockResolvedValueOnce(
        activePrediction({ status: "RESOLVED", winningOutcomeId: "outcome-a" }),
      );
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chatServiceMock.emit).toHaveBeenCalledTimes(2);
    expect(chatServiceMock.emit.mock.calls[1][1]).toMatchObject({
      status: "RESOLVED",
      winningOutcomeId: "outcome-a",
    });
  });

  it("emits when viewerOutcomeId flips from null → set (viewer just voted)", async () => {
    fetchChannelPredictionMock
      .mockResolvedValueOnce(activePrediction())
      .mockResolvedValueOnce(activePrediction({ viewerOutcomeId: "outcome-a", viewerStake: 100 }));
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(chatServiceMock.emit).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------
// Stop-after-null behavior
// ------------------------------------------------------------

describe("stop after consecutive null responses", () => {
  it("stops polling after two consecutive null responses from start", async () => {
    fetchChannelPredictionMock.mockResolvedValue(null);
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks(); // first null
    await vi.advanceTimersByTimeAsync(5_000); // second null → stops
    // After the stop, advancing further should not fire the fetch again.
    fetchChannelPredictionMock.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchChannelPredictionMock).not.toHaveBeenCalled();
  });

  it("resets the null streak on a non-null response (does not stop prematurely)", async () => {
    fetchChannelPredictionMock
      .mockResolvedValueOnce(null) // first null
      .mockResolvedValueOnce(activePrediction()) // recovers
      .mockResolvedValueOnce(null) // first null again — streak resets to 1
      .mockResolvedValue(null); // continues null but only 2 total since reset would need 2
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    // After three ticks, the second null is just the start of a new streak.
    // Poll should still be alive — verify by checking another fetch fires.
    fetchChannelPredictionMock.mockClear();
    await vi.advanceTimersByTimeAsync(5_000);
    // The next tick triggers the second null in the new streak, which stops.
    // But before that tick happens, a single advanceTimers call fires one
    // tick. We use the call count to assert at-least-one extra fetch.
    expect(fetchChannelPredictionMock).toHaveBeenCalled();
  });

  it("re-arms when start is called after auto-stop", async () => {
    fetchChannelPredictionMock.mockResolvedValue(null);
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(5_000); // auto-stop after second null
    fetchChannelPredictionMock.mockClear();
    fetchChannelPredictionMock.mockResolvedValueOnce(activePrediction());
    // Fresh start should re-bootstrap.
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(1);
    expect(chatServiceMock.emit).toHaveBeenCalledWith(
      "predictionUpdate",
      expect.objectContaining({ id: "pred-1" }),
    );
  });
});

// ------------------------------------------------------------
// Visibility-aware polling
// ------------------------------------------------------------

describe("visibility-aware polling", () => {
  // jsdom's document.visibilityState is read-only; override via property descriptor.
  function setHidden(hidden: boolean): void {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
  }

  afterEach(() => {
    setHidden(false);
  });

  it("skips the scheduled tick when document.visibilityState === 'hidden'", async () => {
    fetchChannelPredictionMock.mockResolvedValue(activePrediction());
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(1);

    // Hide and advance — no extra fetch should fire.
    setHidden(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(1);

    // Restore visibility — the scheduled interval continues to fire from now on.
    setHidden(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(2);
  });
});

// ------------------------------------------------------------
// stop teardown
// ------------------------------------------------------------

describe("stopTwitchPredictionPolling", () => {
  it("clears the interval and prevents further fetches", async () => {
    fetchChannelPredictionMock.mockResolvedValue(activePrediction());
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    stopTwitchPredictionPolling("ramee");
    fetchChannelPredictionMock.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchChannelPredictionMock).not.toHaveBeenCalled();
  });

  it("is a no-op when called for an unknown login", () => {
    expect(() => stopTwitchPredictionPolling("not-running")).not.toThrow();
  });
});

// ------------------------------------------------------------
// Three-auth-state matrix
// ------------------------------------------------------------

describe("three-auth-state matrix (auth-state coverage per plan)", () => {
  it("guest / no electronAPI installed — calls fetcher with accessToken: undefined and emits without viewerOutcomeId", async () => {
    fetchChannelPredictionMock.mockResolvedValue(activePrediction()); // no self block
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    // Verify the fetcher was called WITHOUT an Authorization-bearing token —
    // the guest path.
    expect(fetchChannelPredictionMock).toHaveBeenCalledWith("ramee", {
      accessToken: undefined,
    });
    expect(chatServiceMock.emit).toHaveBeenCalledWith(
      "predictionUpdate",
      expect.objectContaining({ viewerOutcomeId: null }),
    );
  });

  it("signed-in (electronAPI returns token) — calls fetcher with the token and emits with viewerOutcomeId", async () => {
    installElectronApi(async () => "tok-1");
    fetchChannelPredictionMock.mockResolvedValue(
      activePrediction({ viewerOutcomeId: "outcome-a", viewerStake: 250 }),
    );
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    expect(fetchChannelPredictionMock).toHaveBeenCalledWith("ramee", {
      accessToken: "tok-1",
    });
    expect(chatServiceMock.emit).toHaveBeenCalledWith(
      "predictionUpdate",
      expect.objectContaining({ viewerOutcomeId: "outcome-a", viewerStake: 250 }),
    );
  });

  it("StreamFusion signed in but no Twitch OAuth — getValidTwitchToken returns null → calls fetcher with accessToken: undefined", async () => {
    installElectronApi(async () => null);
    fetchChannelPredictionMock.mockResolvedValue(activePrediction());
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    expect(fetchChannelPredictionMock).toHaveBeenCalledWith("ramee", {
      accessToken: undefined,
    });
  });
});

// ------------------------------------------------------------
// 401 + refresh path
// ------------------------------------------------------------

describe("401 → refresh + retry (renderer-safe seam)", () => {
  it("retries once via getValidTwitchToken when the first call throws 401", async () => {
    const tokenFn = vi.fn<() => Promise<string | null>>().mockResolvedValue("tok-fresh");
    installElectronApi(tokenFn);
    fetchChannelPredictionMock
      .mockRejectedValueOnce(new Error("ChannelPredictionContext 401"))
      .mockResolvedValueOnce(activePrediction());
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    // First fetch threw 401; retry should have succeeded. Both calls happen
    // within the bootstrap tick.
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(2);
    expect(tokenFn).toHaveBeenCalledTimes(2); // initial token + refresh
    expect(chatServiceMock.emit).toHaveBeenCalledWith(
      "predictionUpdate",
      expect.objectContaining({ id: "pred-1" }),
    );
  });

  it("does NOT loop indefinitely if the retry also fails (skips tick instead)", async () => {
    const tokenFn = vi.fn<() => Promise<string | null>>().mockResolvedValue("tok-fresh");
    installElectronApi(tokenFn);
    fetchChannelPredictionMock.mockRejectedValue(
      new Error("ChannelPredictionContext 401"),
    );
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    // Two attempts on the bootstrap tick (initial + retry), then no further
    // attempts until the next interval tick.
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(2);
    expect(chatServiceMock.emit).not.toHaveBeenCalled();
  });

  it("does NOT retry for non-401 errors", async () => {
    installElectronApi(async () => "tok-1");
    fetchChannelPredictionMock.mockRejectedValueOnce(
      new Error("ChannelPredictionContext 500"),
    );
    startTwitchPredictionPolling("ramee");
    await flushMicrotasks();
    // Single attempt — 500s don't trigger refresh.
    expect(fetchChannelPredictionMock).toHaveBeenCalledTimes(1);
  });
});
