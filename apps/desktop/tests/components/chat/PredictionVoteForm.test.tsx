import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PredictionVoteForm,
  type PredictionVoteFormBalance,
} from "@/components/chat/PredictionVoteForm";
import { __resetForTests, acquire, predictionVoteGateKey } from "@/lib/prediction-vote-gate";
import type { UnifiedPrediction } from "@/shared/chat-types";

// Mock the two mutation modules — the form is the seam between the gate
// + auth-token retrieval and the platform-specific mutation. Tests exercise
// each mutation result path through the form's UI.
const makePredictionMock = vi.fn();
const voteOnPredictionMock = vi.fn();

vi.mock("@/backend/api/platforms/twitch/twitch-gql-prediction-mutations", () => ({
  makePrediction: (...args: unknown[]) => makePredictionMock(...args),
}));
vi.mock("@/backend/api/platforms/kick/kick-prediction-mutations", () => ({
  voteOnPrediction: (...args: unknown[]) => voteOnPredictionMock(...args),
}));

function makePrediction(overrides: Partial<UnifiedPrediction> = {}): UnifiedPrediction {
  return {
    id: "pred-1",
    platform: "twitch",
    channelId: "12345",
    channelSlug: "fitzbro",
    title: "Who wins next game?",
    status: "ACTIVE",
    outcomes: [
      {
        id: "outcome-a",
        title: "Sodapoppin",
        color: "blue",
        totalAmount: 500,
        userCount: 10,
      },
      {
        id: "outcome-b",
        title: "EggsQc",
        color: "pink",
        totalAmount: 300,
        userCount: 8,
      },
    ],
    winningOutcomeId: null,
    predictionWindowSeconds: 120,
    endedAt: null,
    viewerOutcomeId: null,
    viewerStake: null,
    ...overrides,
  };
}

const LOADED_BALANCE: PredictionVoteFormBalance = { state: "loaded", value: 500 };

const tokenGetterMock = vi.fn().mockResolvedValue({ accessToken: "tok-1" });

beforeEach(() => {
  __resetForTests();
  makePredictionMock.mockReset();
  voteOnPredictionMock.mockReset();
  tokenGetterMock.mockReset();
  tokenGetterMock.mockResolvedValue({ accessToken: "tok-1" });
  (globalThis.window as unknown as { electronAPI: unknown }).electronAPI = {
    auth: {
      getToken: tokenGetterMock,
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PredictionVoteForm — happy path", () => {
  it("renders outcome buttons + stake input + submit", () => {
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    expect(screen.getByTestId("vote-outcome-outcome-a")).toBeTruthy();
    expect(screen.getByTestId("vote-outcome-outcome-b")).toBeTruthy();
    expect(screen.getByTestId("vote-stake-input")).toBeTruthy();
    expect(screen.getByTestId("vote-submit")).toBeTruthy();
  });

  it("happy path (Twitch): submit fires makePrediction with the picked outcome and amount", async () => {
    makePredictionMock.mockResolvedValue({ ok: true });
    const onVoteSuccess = vi.fn();
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
        onVoteSuccess={onVoteSuccess}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("vote-submit"));

    await waitFor(() => expect(makePredictionMock).toHaveBeenCalledTimes(1));
    expect(makePredictionMock).toHaveBeenCalledWith({
      accessToken: "tok-1",
      eventID: "pred-1",
      outcomeID: "outcome-a",
      points: 100,
    });
    await waitFor(() => expect(onVoteSuccess).toHaveBeenCalledWith("outcome-a", 100));
  });

  it("happy path (Kick): submit fires voteOnPrediction with channelSlug + outcomeId + amount", async () => {
    voteOnPredictionMock.mockResolvedValue({ ok: true });
    const onVoteSuccess = vi.fn();
    render(
      <PredictionVoteForm
        prediction={makePrediction({ platform: "kick", channelSlug: "ramee" })}
        channelLogin="ramee"
        balance={{ state: "loaded", value: 1000 }}
        onVoteSuccess={onVoteSuccess}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-b"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "250" } });
    fireEvent.click(screen.getByTestId("vote-submit"));

    await waitFor(() => expect(voteOnPredictionMock).toHaveBeenCalledTimes(1));
    expect(voteOnPredictionMock).toHaveBeenCalledWith({
      accessToken: "tok-1",
      channelSlug: "ramee",
      predictionId: "pred-1",
      outcomeId: "outcome-b",
      amount: 250,
    });
    await waitFor(() => expect(onVoteSuccess).toHaveBeenCalledWith("outcome-b", 250));
  });
});

describe("PredictionVoteForm — input validation", () => {
  it("submit disabled when no outcome is picked", () => {
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    expect((screen.getByTestId("vote-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("submit disabled and no fetch fires when amount is 0", async () => {
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "0" } });
    expect((screen.getByTestId("vote-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("vote-submit"));
    expect(makePredictionMock).not.toHaveBeenCalled();
  });

  it("renders preflight hint when amount exceeds loaded balance, submit disabled", () => {
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "1000" } });
    expect(screen.getByTestId("vote-preflight-hint").textContent).toContain("Not enough points");
    expect((screen.getByTestId("vote-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders preflight hint when amount exceeds the 250k cap", () => {
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={{ state: "loaded", value: 9_999_999 }}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "300000" } });
    expect(screen.getByTestId("vote-preflight-hint").textContent).toContain("Maximum 250,000");
    expect((screen.getByTestId("vote-submit") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("PredictionVoteForm — balance states", () => {
  it("shows 'Loading balance…' and disables submit when balance is loading", () => {
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={{ state: "loading" }}
      />,
    );
    expect(screen.getByTestId("vote-balance-line").textContent).toContain("Loading balance…");
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    expect((screen.getByTestId("vote-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows 'Balance unavailable' on failed state and still allows submit", async () => {
    makePredictionMock.mockResolvedValue({ ok: true });
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={{ state: "failed", reason: "not implemented" }}
      />,
    );
    expect(screen.getByTestId("vote-balance-line").textContent).toContain("Balance unavailable");
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    expect((screen.getByTestId("vote-submit") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("vote-submit"));
    await waitFor(() => expect(makePredictionMock).toHaveBeenCalledTimes(1));
  });

  it("renders KCP unit when platform is kick", () => {
    render(
      <PredictionVoteForm
        prediction={makePrediction({ platform: "kick", channelSlug: "ramee" })}
        channelLogin="ramee"
        balance={{ state: "loaded", value: 1234 }}
      />,
    );
    expect(screen.getByTestId("vote-balance-line").textContent).toContain("1,234 KCP");
  });
});

describe("PredictionVoteForm — per-kind error copy", () => {
  const errorKinds: Array<{
    kind: string;
    expect: RegExp;
    platform?: "twitch" | "kick";
  }> = [
    { kind: "insufficientBalance", expect: /Not enough points/ },
    { kind: "insufficientBalance", expect: /Not enough KCP/, platform: "kick" },
    { kind: "outcomeLocked", expect: /Voting closed before your vote registered/ },
    { kind: "predictionGone", expect: /Prediction ended/ },
    { kind: "unauthenticated", expect: /Reconnect Twitch to vote/ },
    { kind: "auth", expect: /Reconnect Twitch to vote/ },
    { kind: "auth", expect: /Reconnect Kick to vote/, platform: "kick" },
    { kind: "integrity", expect: /Twitch is rate-limiting/ },
    { kind: "network", expect: /Network error — try again/ },
    { kind: "invalidInput", expect: /Invalid input/ },
    { kind: "unknown", expect: /Unexpected error/ },
    { kind: "forbidden", expect: /Voting not allowed/ },
  ];

  for (const tc of errorKinds) {
    it(`surfaces "${tc.expect.source}" copy for kind=${tc.kind}${tc.platform ? ` (${tc.platform})` : ""}`, async () => {
      const platform = tc.platform ?? "twitch";
      if (platform === "twitch") {
        makePredictionMock.mockResolvedValue({ ok: false, kind: tc.kind, message: "raw msg" });
      } else {
        voteOnPredictionMock.mockResolvedValue({ ok: false, kind: tc.kind, message: "raw msg" });
      }
      render(
        <PredictionVoteForm
          prediction={makePrediction({ platform, channelSlug: platform === "kick" ? "ramee" : "fitzbro" })}
          channelLogin={platform === "kick" ? "ramee" : "fitzbro"}
          balance={LOADED_BALANCE}
        />,
      );
      fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
      fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
      fireEvent.click(screen.getByTestId("vote-submit"));
      await waitFor(() => expect(screen.getByTestId("vote-error")).toBeTruthy());
      expect(screen.getByTestId("vote-error").textContent ?? "").toMatch(tc.expect);
    });
  }

  it("does NOT render the raw message for kind=unknown (SEC-005)", async () => {
    makePredictionMock.mockResolvedValue({
      ok: false,
      kind: "unknown",
      message: "raw-server-text-that-must-not-appear",
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("vote-submit"));
    await waitFor(() => expect(screen.getByTestId("vote-error")).toBeTruthy());
    expect(screen.getByTestId("vote-error").textContent ?? "").not.toContain(
      "raw-server-text-that-must-not-appear",
    );
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("renders a retry button for kind=network and re-fires the submit on click", async () => {
    makePredictionMock
      .mockResolvedValueOnce({ ok: false, kind: "network", message: "timeout" })
      .mockResolvedValueOnce({ ok: true });
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("vote-submit"));
    await waitFor(() => expect(screen.getByTestId("vote-retry")).toBeTruthy());
    fireEvent.click(screen.getByTestId("vote-retry"));
    await waitFor(() => expect(makePredictionMock).toHaveBeenCalledTimes(2));
  });
});

describe("PredictionVoteForm — gate + token handling", () => {
  it("rapid double-click only fires the mutation once (gate blocks duplicate)", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    makePredictionMock.mockImplementation(() => new Promise((res) => {
      resolveFn = res;
    }));
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    // First click → kicks off the mutation, gate acquired
    fireEvent.click(screen.getByTestId("vote-submit"));
    // Second click before mutation resolves
    fireEvent.click(screen.getByTestId("vote-submit"));
    fireEvent.click(screen.getByTestId("vote-submit"));
    // Resolve the mutation
    resolveFn({ ok: true });
    await waitFor(() => expect(makePredictionMock).toHaveBeenCalledTimes(1));
  });

  it("releases the gate even when the mutation throws (try/finally)", async () => {
    makePredictionMock.mockRejectedValue(new Error("boom"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("vote-submit"));
    await waitFor(() => expect(screen.getByTestId("vote-error")).toBeTruthy());
    // Gate should have been released → next acquire of the same key succeeds.
    const key = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    expect(acquire(key)).toBe(true);
    warnSpy.mockRestore();
  });

  it("surfaces auth error when getToken returns null (no token cached anywhere)", async () => {
    tokenGetterMock.mockResolvedValue(null);
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("vote-submit"));
    await waitFor(() => expect(screen.getByTestId("vote-error")).toBeTruthy());
    expect(screen.getByTestId("vote-error").getAttribute("data-error-kind")).toBe("auth");
    expect(makePredictionMock).not.toHaveBeenCalled();
  });

  it("retrieves token AT submit time (not on mount)", () => {
    render(
      <PredictionVoteForm
        prediction={makePrediction()}
        channelLogin="fitzbro"
        balance={LOADED_BALANCE}
      />,
    );
    // Mount alone does not retrieve the token.
    expect(tokenGetterMock).not.toHaveBeenCalled();
  });
});
