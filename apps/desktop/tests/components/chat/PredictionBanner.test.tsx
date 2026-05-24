import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

import { PredictionBanner } from "@/components/chat/PredictionBanner";
import type { UnifiedPrediction } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";

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
    createdAt: null,
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

  it("expands to a detail panel showing the numbered outcome list on CTA click", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.getByText("Sodapoppin")).toBeTruthy();
    expect(screen.getByText("EggsQc")).toBeTruthy();
    expect(screen.getByTestId("prediction-outcomes")).toBeTruthy();
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

  it("expanded ended state renders all outcomes as a vertical results list with percentages + Winner badge", () => {
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
    expect(screen.getByText("Sodapoppin")).toBeTruthy();
    expect(screen.getByText("EggsQc")).toBeTruthy();
    // "Winner" badge marks the broadcaster-chosen outcome (twitch.tv results layout).
    expect(screen.getByText("Winner")).toBeTruthy();
    // Each outcome shows a percentage (now in spans, not a 2-column grid of divs).
    const percentNodes = Array.from(document.querySelectorAll("span")).filter(
      (s) => /^\d+%$/.test(s.textContent || ""),
    );
    expect(percentNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("expanded active state renders numbered outcome rows with amounts (twitch.tv layout)", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    // Each outcome row is a list item with the platform-amount short label.
    const rowA = screen.getByTestId("prediction-outcome-outcome-a");
    const rowB = screen.getByTestId("prediction-outcome-outcome-b");
    expect(rowA.textContent).toMatch(/Sodapoppin/);
    expect(rowB.textContent).toMatch(/EggsQc/);
    // Numbered prefix on each row (matches twitch.tv's "1." / "2." pattern).
    expect(rowA.textContent).toMatch(/1\./);
    expect(rowB.textContent).toMatch(/2\./);
    // Short amount label rendered ("979.1K" + "848.9K" from the fixture).
    expect(rowA.textContent).toMatch(/979\.1K/);
    expect(rowB.textContent).toMatch(/848\.9K/);
    // Twitch's compact card shows amounts only — no per-row percentage.
    expect(rowA.textContent).not.toMatch(/%/);
    expect(rowB.textContent).not.toMatch(/%/);
  });

  it("renders every outcome in the resolved list (3+) with the Winner badge on the broadcaster-chosen outcome", () => {
    // Winner is outcomes[2] AND the lowest amount — the badge follows
    // winningOutcomeId, not the highest percentage (mirrors twitch.tv, where
    // No Neck Jay won at 40% over Shane Chance's 59%).
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
    // All three outcomes render (no 2-column truncation / hoisting).
    expect(screen.getByText("Sodapoppin")).toBeTruthy();
    expect(screen.getByText("EggsQc")).toBeTruthy();
    expect(screen.getByText("Roflgator")).toBeTruthy();
    // Winner badge present, pinned to the broadcaster-chosen (lowest-amount) outcome.
    expect(screen.getByText("Winner")).toBeTruthy();
    const winnerRow = screen.getByTestId("prediction-outcome-outcome-c");
    expect(winnerRow.getAttribute("data-winner")).toBe("true");
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
// Read-only: the widget mirrors Twitch's card but offers no vote affordance.
// ────────────────────────────────────────────────────────────────────────────

describe("PredictionBanner — read-only (no in-app voting)", () => {
  it("expanded active view shows outcomes but neither a vote form nor a deeplink", () => {
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.getByTestId("prediction-outcomes")).toBeTruthy();
    expect(screen.getByText("Sodapoppin")).toBeTruthy();
    expect(screen.queryByTestId("prediction-vote-form")).toBeNull();
    expect(screen.queryByTestId("prediction-vote-deeplink")).toBeNull();
    expect(screen.queryByText(/Vote on/)).toBeNull();
  });

  it("stays read-only even when a Twitch user is signed in", () => {
    setTwitchUser();
    render(<PredictionBanner prediction={makePrediction()} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.queryByTestId("prediction-vote-form")).toBeNull();
    expect(screen.queryByTestId("prediction-vote-deeplink")).toBeNull();
  });

  it("highlights the viewer's on-platform pick without exposing a vote control", () => {
    render(
      <PredictionBanner
        prediction={makePrediction({ viewerOutcomeId: "outcome-a", viewerStake: 500 })}
      />,
    );
    fireEvent.click(screen.getByLabelText("See Details"));
    const picked = screen.getByTestId("prediction-outcome-outcome-a");
    expect(picked.getAttribute("data-viewer-pick")).toBe("true");
    expect(screen.queryByTestId("prediction-vote-form")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Time-remaining bar countdown (createdAt + predictionWindowSeconds).
// ────────────────────────────────────────────────────────────────────────────

describe("PredictionBanner — time-remaining countdown", () => {
  it("counts the bar down from full toward empty as the window elapses", () => {
    vi.useFakeTimers();
    try {
      const start = Date.now();
      vi.setSystemTime(start);
      render(
        <PredictionBanner
          prediction={makePrediction({
            predictionWindowSeconds: 100,
            createdAt: new Date(start).toISOString(),
          })}
        />,
      );
      const bar = screen.getByRole("progressbar");
      // Full at the start of the window.
      expect(Number(bar.getAttribute("aria-valuenow"))).toBe(100);

      // Halfway through the 100s window → ~50%.
      act(() => {
        vi.advanceTimersByTime(50_000);
      });
      const mid = Number(bar.getAttribute("aria-valuenow"));
      expect(mid).toBeGreaterThan(40);
      expect(mid).toBeLessThan(60);

      // Past the end → clamped at 0.
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(Number(bar.getAttribute("aria-valuenow"))).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a static full bar when no createdAt anchor is present", () => {
    render(<PredictionBanner prediction={makePrediction({ createdAt: null })} />);
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBe(100);
  });

  it("renders an empty bar when the prediction is LOCKED", () => {
    render(
      <PredictionBanner
        prediction={makePrediction({
          status: "LOCKED",
          createdAt: new Date().toISOString(),
        })}
      />,
    );
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBe(0);
  });
});
