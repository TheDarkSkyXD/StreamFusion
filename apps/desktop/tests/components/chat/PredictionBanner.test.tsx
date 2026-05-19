import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { PredictionBanner } from "@/components/chat/PredictionBanner";
import type { UnifiedPrediction } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";

function makePrediction(overrides: Partial<UnifiedPrediction> = {}): UnifiedPrediction {
  return {
    id: "pred-1",
    platform: "twitch",
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
  }));
});

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

  it("renders 'Resolved' badge + 'Winner' tag on winning outcome when status is RESOLVED", () => {
    render(
      <PredictionBanner
        prediction={makePrediction({ status: "RESOLVED", winningOutcomeId: "outcome-a", endedAt: "2026-05-18T22:02:11Z" })}
      />,
    );
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.getByText("Resolved")).toBeTruthy();
    expect(screen.getByText("Winner")).toBeTruthy();
    expect(screen.queryByTestId("prediction-vote-deeplink")).toBeNull();
  });

  it("renders 'Canceled — refunded' badge when status is CANCELED", () => {
    render(<PredictionBanner prediction={makePrediction({ status: "CANCELED" })} />);
    fireEvent.click(screen.getByLabelText("See Details"));
    expect(screen.getByText("Canceled — refunded")).toBeTruthy();
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
});
