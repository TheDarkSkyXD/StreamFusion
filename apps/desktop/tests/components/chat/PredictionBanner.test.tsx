import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

import { PredictionBanner } from "@/components/chat/PredictionBanner";
import {
  __resetForTests as resetGate,
  acquire as acquireGate,
  predictionVoteGateKey,
} from "@/lib/prediction-vote-gate";
import type { UnifiedPrediction } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";

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
        totalAmount: 979_100,
        userCount: 1245,
      },
      {
        id: "outcome-b",
        title: "EggsQc",
        color: "pink",
        totalAmount: 848_900,
        userCount: 980,
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

beforeEach(() => {
  // Reset preferences to default each test so style branching is predictable.
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      predictions: { style: "native" },
    } as typeof s.preferences,
    twitchUser: null,
    kickUser: null,
  }));
  resetGate();
  makePredictionMock.mockReset();
  voteOnPredictionMock.mockReset();
  (globalThis.window as unknown as { electronAPI: unknown }).electronAPI = {
    auth: {
      getToken: vi.fn().mockResolvedValue({ accessToken: "tok-1" }),
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

function setTwitchUser() {
  useAuthStore.setState((s) => ({
    ...s,
    twitchUser: {
      id: "u1",
      login: "viewer",
      displayName: "Viewer",
      profileImageUrl: "",
      createdAt: "",
      broadcasterType: "",
    } as unknown as typeof s.twitchUser,
  }));
}

function setKickUser() {
  useAuthStore.setState((s) => ({
    ...s,
    kickUser: {
      id: "kv1",
      login: "kickviewer",
      displayName: "KickViewer",
    } as unknown as typeof s.kickUser,
  }));
}

describe("PredictionBanner (read-only viewer widget)", () => {
  it("renders collapsed by default with the platform-native CTA label (Twitch → 'See Details')", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    expect(screen.getByText("Who wins next game?")).toBeTruthy();
    expect(screen.getByLabelText("See Details")).toBeTruthy();
    expect(screen.queryByText(/Vote on twitch.tv/)).toBeNull();
  });

  it("renders Kick-native CTA label ('Predict') for Kick predictions", () => {
    render(<PredictionBanner prediction={makePrediction({ platform: "kick" })} />);
    expect(screen.getByLabelText("Predict")).toBeTruthy();
  });

  it("expands to detail panel on CTA click, showing outcome list + 'Vote on twitch.tv' deeplink", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.getByText("Sodapoppin")).toBeTruthy();
    expect(screen.getByText("EggsQc")).toBeTruthy();
    const deeplink = screen.getByTestId("prediction-vote-deeplink") as HTMLAnchorElement;
    expect(deeplink.href).toBe("https://www.twitch.tv/");
    expect(deeplink.textContent).toContain("Vote on twitch.tv");
  });

  it("collapses back when the Back / Close control is clicked", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    fireEvent.click(screen.getByLabelText("Collapse prediction panel"));
    expect(screen.queryByText("Sodapoppin")).toBeNull();
  });

  it("renders 'Voting locked' badge in expanded panel when status is LOCKED", () => {
    render(<PredictionBanner prediction={makePrediction({ status: "LOCKED" })} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.getByText("Voting locked")).toBeTruthy();
    expect(screen.queryByTestId("prediction-vote-deeplink")).toBeNull();
  });

  it("renders 'Winner' tag + ended-state subtitle on winning outcome when status is RESOLVED", () => {
    render(
      <PredictionBanner
        prediction={makePrediction({ status: "RESOLVED", winningOutcomeId: "outcome-a", endedAt: "2026-05-18T22:02:11Z" })}
      />,
    );
    // Ended states use "View Result" CTA instead of "See Details"
    fireEvent.click(screen.getByLabelText("View Result"));
    expect(screen.getByText(/Prediction ended/)).toBeTruthy();
    expect(screen.getByText(/Winner/)).toBeTruthy();
    expect(screen.queryByTestId("prediction-vote-deeplink")).toBeNull();
  });

  it("renders canceled-refunded subtitle when status is CANCELED", () => {
    render(<PredictionBanner prediction={makePrediction({ status: "CANCELED" })} />);
    fireEvent.click(screen.getByLabelText("View Result"));
    expect(screen.getByText(/Prediction canceled — refunded/)).toBeTruthy();
  });

  it("calls onAutoDismiss after ENDED_AUTO_DISMISS_MS for RESOLVED state", () => {
    vi.useFakeTimers();
    try {
      const onAutoDismiss = vi.fn();
      render(
        <PredictionBanner
          prediction={makePrediction({ status: "RESOLVED", winningOutcomeId: "outcome-a" })}
          onAutoDismiss={onAutoDismiss}
        />,
      );
      vi.advanceTimersByTime(60_000);
      expect(onAutoDismiss).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT call onAutoDismiss for ACTIVE state", () => {
    vi.useFakeTimers();
    try {
      const onAutoDismiss = vi.fn();
      render(
        <PredictionBanner prediction={makePrediction()} onAutoDismiss={onAutoDismiss} />,
      );
      vi.advanceTimersByTime(120_000);
      expect(onAutoDismiss).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses unified styling when preference is set to 'unified'", () => {
    useAuthStore.setState((s) => ({
      ...s,
      preferences: {
        ...(s.preferences ?? {}),
        predictions: { style: "unified" },
      } as typeof s.preferences,
    }));
    render(<PredictionBanner prediction={makePrediction()} />);
    const banner = screen.getByTestId("prediction-banner");
    expect(banner.getAttribute("data-style")).toBe("unified");
  });

  it("data-style is 'twitch-native' for Twitch + native preference", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    expect(screen.getByTestId("prediction-banner").getAttribute("data-style")).toBe(
      "twitch-native",
    );
  });

  it("data-style is 'kick-native' for Kick + native preference", () => {
    render(<PredictionBanner prediction={makePrediction({ platform: "kick" })} />);
    expect(screen.getByTestId("prediction-banner").getAttribute("data-style")).toBe(
      "kick-native",
    );
  });

  it("collapses expanded state when a new prediction id arrives", () => {
    const { rerender } = render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    // Outcome list is visible when expanded
    expect(screen.getByTestId("prediction-outcomes")).toBeTruthy();
    // New prediction id triggers the collapse-reset effect
    rerender(<PredictionBanner prediction={makePrediction({ id: "pred-2" })} />);
    expect(screen.queryByTestId("prediction-outcomes")).toBeNull();
    // CTA is visible again (collapsed view)
    expect(screen.getByLabelText("See Details")).toBeTruthy();
  });

  it("renders a dismiss control in the collapsed view when onDismiss is provided", () => {
    render(<PredictionBanner prediction={makePrediction()} onDismiss={() => {}} />);
    expect(screen.getByTestId("prediction-dismiss")).toBeTruthy();
  });

  it("hides the dismiss control when onDismiss is NOT provided", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    expect(screen.queryByTestId("prediction-dismiss")).toBeNull();
  });

  it("calls onDismiss when the collapsed-view dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(<PredictionBanner prediction={makePrediction()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId("prediction-dismiss"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders an expanded-view dismiss control when onDismiss is provided", () => {
    render(<PredictionBanner prediction={makePrediction()} onDismiss={() => {}} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.getByTestId("prediction-dismiss-expanded")).toBeTruthy();
  });

  it("calls onDismiss when the expanded-view dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(<PredictionBanner prediction={makePrediction()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    fireEvent.click(screen.getByTestId("prediction-dismiss-expanded"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("falls back to a collapse-only ✕ in expanded view when onDismiss is not provided", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.queryByTestId("prediction-dismiss-expanded")).toBeNull();
    // The non-dismiss ✕ is the close-panel one — clicking it collapses.
    fireEvent.click(screen.getByLabelText("Close prediction panel"));
    expect(screen.queryByTestId("prediction-outcomes")).toBeNull();
  });

  it("dismiss control is also available during LOCKED and ended states (so users can hide them)", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <PredictionBanner
        prediction={makePrediction({ status: "LOCKED" })}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId("prediction-dismiss")).toBeTruthy();
    rerender(
      <PredictionBanner
        prediction={makePrediction({
          id: "pred-resolved",
          status: "RESOLVED",
          winningOutcomeId: "outcome-a",
        })}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId("prediction-dismiss")).toBeTruthy();
  });

  it("expanded ended state renders two-column layout with progress bars (visual-faithful)", () => {
    render(
      <PredictionBanner
        prediction={makePrediction({
          status: "RESOLVED",
          winningOutcomeId: "outcome-a",
          endedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText("View Result"));
    // Both outcomes render in the side-by-side columns
    expect(screen.getByText("Sodapoppin")).toBeTruthy();
    expect(screen.getByText("EggsQc")).toBeTruthy();
    // Big-number percentage display (53% leader in our test fixture)
    const percentNodes = Array.from(document.querySelectorAll("div")).filter(
      (d) => /^\d+%$/.test(d.textContent || ""),
    );
    expect(percentNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("expanded active state renders bubble cluster for Twitch native with leader-percentage", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    // Big leader percentage is rendered with a large font size class.
    const bigNumber = Array.from(document.querySelectorAll("div")).find(
      (d) =>
        /^\d+%$/.test(d.textContent || "") &&
        /text-\[(32|36|40|44|48)px\]/.test(d.className || ""),
    );
    expect(bigNumber).toBeTruthy();
  });

  it("EndedPanel hoists the winner into the displayed pair for 3+ outcome predictions", () => {
    // Winner is outcomes[2] — declared order would hide it. The panel must
    // promote it into the right slot so the resolution is always visible.
    const prediction = makePrediction({
      status: "RESOLVED",
      winningOutcomeId: "outcome-c",
      outcomes: [
        {
          id: "outcome-a",
          title: "Sodapoppin",
          color: "blue",
          totalAmount: 500_000,
          userCount: 200,
        },
        {
          id: "outcome-b",
          title: "EggsQc",
          color: "pink",
          totalAmount: 300_000,
          userCount: 150,
        },
        {
          id: "outcome-c",
          title: "Roflgator",
          color: "yellow",
          totalAmount: 100_000,
          userCount: 50,
        },
      ],
    });
    render(<PredictionBanner prediction={prediction} />);
    fireEvent.click(screen.getByLabelText("View Result"));
    // Winner outcome must render even though it's outcomes[2].
    expect(screen.getByText("Roflgator")).toBeTruthy();
    // The "Winner" tag points at it.
    expect(screen.getByText(/Winner/)).toBeTruthy();
  });

  it("PredictionBanner auto-dismiss timer does NOT reset on parent re-render with a new inline callback", () => {
    // Regression for the P1-3 finding: passing a fresh inline arrow on every
    // render must NOT bounce the 60s timer. Re-render with a brand-new
    // function reference repeatedly within the timeout window and confirm
    // the dismiss still fires exactly once.
    vi.useFakeTimers();
    try {
      let calls = 0;
      const prediction = makePrediction({
        status: "RESOLVED",
        winningOutcomeId: "outcome-a",
      });
      const { rerender } = render(
        <PredictionBanner
          prediction={prediction}
          onAutoDismiss={() => {
            calls += 1;
          }}
        />,
      );
      // Re-render 5 times with new callback identity each pass (parent re-renders).
      for (let i = 0; i < 5; i += 1) {
        vi.advanceTimersByTime(10_000); // 50_000ms elapsed total
        rerender(
          <PredictionBanner
            prediction={prediction}
            onAutoDismiss={() => {
              calls += 1;
            }}
          />,
        );
      }
      // Now push past the 60s mark.
      vi.advanceTimersByTime(15_000);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// U5 — form-vs-deeplink branch + localVoteSubmittedAt defense + gate cleanup
// ────────────────────────────────────────────────────────────────────────────

describe("PredictionBanner — U5 form/deeplink branch", () => {
  it("shows in-app vote form (not deeplink) when prediction is ACTIVE and Twitch user is signed in", () => {
    setTwitchUser();
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.getByTestId("prediction-vote-form")).toBeTruthy();
    expect(screen.queryByTestId("prediction-vote-deeplink")).toBeNull();
  });

  it("shows deeplink (not form) when prediction is ACTIVE and no Twitch user is signed in", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.queryByTestId("prediction-vote-form")).toBeNull();
    expect(screen.getByTestId("prediction-vote-deeplink")).toBeTruthy();
  });

  it("shows deeplink (not in-app form) for Kick even when Kick user is signed in — Kick voting requires session cookies + CSRF; deferred to BrowserWindow scrape", () => {
    setKickUser();
    render(<PredictionBanner prediction={makePrediction({ platform: "kick" })} />);
    fireEvent.click(screen.getByLabelText("Predict"));
    expect(screen.queryByTestId("prediction-vote-form")).toBeNull();
    expect(screen.getByTestId("prediction-vote-deeplink")).toBeTruthy();
  });

  it("Twitch user signed in does NOT enable Kick form on a Kick prediction (per-platform branch)", () => {
    setTwitchUser();
    render(<PredictionBanner prediction={makePrediction({ platform: "kick" })} />);
    fireEvent.click(screen.getByLabelText("Predict"));
    expect(screen.queryByTestId("prediction-vote-form")).toBeNull();
    expect(screen.getByTestId("prediction-vote-deeplink")).toBeTruthy();
  });

  it("hides both form and deeplink when prediction is LOCKED", () => {
    setTwitchUser();
    render(<PredictionBanner prediction={makePrediction({ status: "LOCKED" })} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.queryByTestId("prediction-vote-form")).toBeNull();
    expect(screen.queryByTestId("prediction-vote-deeplink")).toBeNull();
  });

  it("hides both form and deeplink when viewer already voted (viewerOutcomeId set)", () => {
    setTwitchUser();
    render(
      <PredictionBanner prediction={makePrediction({ viewerOutcomeId: "outcome-a", viewerStake: 100 })} />,
    );
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.queryByTestId("prediction-vote-form")).toBeNull();
    expect(screen.queryByTestId("prediction-vote-deeplink")).toBeNull();
  });
});

describe("PredictionBanner — localVoteSubmittedAt suppression", () => {
  it("suppresses incoming viewerOutcomeId=null update within 10s of successful vote", async () => {
    setTwitchUser();
    makePredictionMock.mockResolvedValue({ ok: true });
    const { rerender } = render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.getByTestId("prediction-vote-form")).toBeTruthy();
    // Cast a vote.
    fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
    fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("vote-submit"));
    await waitFor(() => expect(makePredictionMock).toHaveBeenCalledTimes(1));
    // Form should disappear since the local optimistic state now has the
    // viewer's outcome.
    await waitFor(() => expect(screen.queryByTestId("prediction-vote-form")).toBeNull());

    // Now the server poll comes back with the stale null update. Without
    // suppression this would re-show the form.
    rerender(<PredictionBanner prediction={makePrediction({ viewerOutcomeId: null })} />);
    expect(screen.queryByTestId("prediction-vote-form")).toBeNull();
    // The picked outcome row carries the viewer-pick attr from the
    // optimistic state.
    const outcomeA = screen.getByTestId("prediction-outcome-outcome-a");
    expect(outcomeA.getAttribute("data-viewer-pick")).toBe("true");
  });

  it("accepts viewerOutcomeId=null update AFTER 10s suppression window expires", async () => {
    vi.useFakeTimers();
    try {
      setTwitchUser();
      makePredictionMock.mockResolvedValue({ ok: true });
      const { rerender } = render(<PredictionBanner prediction={makePrediction()} />);
      fireEvent.click(screen.getByLabelText("See Details"));
      fireEvent.click(screen.getByTestId("vote-outcome-outcome-a"));
      fireEvent.change(screen.getByTestId("vote-stake-input"), { target: { value: "100" } });
      // Drive the promise resolution under fake timers — we await the
      // settled mutation by manually running pending microtasks.
      await act(async () => {
        fireEvent.click(screen.getByTestId("vote-submit"));
        // Flush the microtask queue created by the resolved mock.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      // Advance past the suppression window.
      await act(async () => {
        vi.advanceTimersByTime(11_000);
      });

      // Server still returns null — but now we're past 10s, so the
      // suppression no longer applies. The component should not be in
      // optimistic-voted state anymore.
      rerender(<PredictionBanner prediction={makePrediction({ viewerOutcomeId: null })} />);
      // Re-expand to check the panel state (re-render may have collapsed).
      const cta = screen.queryByLabelText("See Details");
      if (cta) fireEvent.click(cta);
      // Form is back since suppression expired and server says null.
      expect(screen.queryByTestId("prediction-vote-form")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PredictionBanner — gate cleanup", () => {
  it("calls clearForPrediction when status transitions to RESOLVED", () => {
    setTwitchUser();
    const { rerender } = render(<PredictionBanner prediction={makePrediction()} />);
    // Seed the gate with this prediction so clearForPrediction has work to do.
    const key = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    acquireGate(key);
    expect(acquireGate(key)).toBe(false); // confirm seeded
    rerender(
      <PredictionBanner
        prediction={makePrediction({ status: "RESOLVED", winningOutcomeId: "outcome-a" })}
      />,
    );
    // Gate cleared → a fresh acquire of the same key succeeds again.
    expect(acquireGate(key)).toBe(true);
  });

  it("calls clearForPrediction when status transitions to CANCELED", () => {
    setTwitchUser();
    const { rerender } = render(<PredictionBanner prediction={makePrediction()} />);
    const key = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    acquireGate(key);
    expect(acquireGate(key)).toBe(false);
    rerender(<PredictionBanner prediction={makePrediction({ status: "CANCELED" })} />);
    expect(acquireGate(key)).toBe(true);
  });

  it("calls clearForChannel on widget unmount", () => {
    setTwitchUser();
    const { unmount } = render(<PredictionBanner prediction={makePrediction()} />);
    // Seed: acquire keys for two predictions on the same channel.
    const k1 = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    const k2 = predictionVoteGateKey("twitch", "fitzbro", "pred-2");
    acquireGate(k1);
    acquireGate(k2);
    unmount();
    // Both should now be releasable / re-acquirable since clearForChannel
    // matched both keys' slug segment.
    expect(acquireGate(k1)).toBe(true);
    expect(acquireGate(k2)).toBe(true);
  });
});
