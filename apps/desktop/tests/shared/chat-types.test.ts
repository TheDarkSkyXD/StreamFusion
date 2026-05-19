import { describe, expect, it } from "vitest";

import type {
  UnifiedPrediction,
  UnifiedPredictionOutcome,
} from "@/shared/chat-types";

describe("UnifiedPrediction shape (U1)", () => {
  it("constructs a Twitch ACTIVE prediction with 2 outcomes and viewer self-state", () => {
    const outcomeA: UnifiedPredictionOutcome = {
      id: "outcome-a",
      title: "Yes",
      color: "blue",
      totalAmount: 979_100,
      userCount: 1245,
    };
    const outcomeB: UnifiedPredictionOutcome = {
      id: "outcome-b",
      title: "No",
      color: "pink",
      totalAmount: 848_900,
      userCount: 980,
    };
    const prediction: UnifiedPrediction = {
      id: "pred-twitch-1",
      platform: "twitch",
      channelId: "12345",
      title: "Who wins next game?",
      status: "ACTIVE",
      outcomes: [outcomeA, outcomeB],
      winningOutcomeId: null,
      predictionWindowSeconds: 120,
      endedAt: null,
      viewerOutcomeId: null,
      viewerStake: null,
    };
    expect(prediction.platform).toBe("twitch");
    expect(prediction.channelId).toBe("12345");
    expect(prediction.outcomes).toHaveLength(2);
    expect(prediction.outcomes[0].color).toBe("blue");
  });

  it("constructs a Kick RESOLVED prediction with the viewer's vote highlighted", () => {
    const prediction: UnifiedPrediction = {
      id: "pred-kick-1",
      platform: "kick",
      channelId: "kick-channel-7",
      title: "Golf it Overall",
      status: "RESOLVED",
      outcomes: [
        {
          id: "kick-1",
          title: "BroVBro",
          color: null,
          totalAmount: 177_700,
          userCount: 412,
        },
        {
          id: "kick-2",
          title: "OqaXex",
          color: null,
          totalAmount: 107_000,
          userCount: 311,
        },
      ],
      winningOutcomeId: "kick-1",
      predictionWindowSeconds: 300,
      endedAt: "2026-05-18T19:42:11Z",
      viewerOutcomeId: "kick-1",
      viewerStake: 250,
    };
    expect(prediction.platform).toBe("kick");
    expect(prediction.outcomes[0].color).toBeNull();
    expect(prediction.viewerOutcomeId).toBe(prediction.winningOutcomeId);
  });

  it("supports Twitch sequential palette colors for multi-outcome predictions (R5 / unified-style 3+)", () => {
    const palette = [
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
    ] as const;
    const outcomes: UnifiedPredictionOutcome[] = palette.map((color, idx) => ({
      id: `outcome-${idx}`,
      title: `Option ${idx + 1}`,
      color,
      totalAmount: 1000 * (idx + 1),
      userCount: idx + 1,
    }));
    expect(outcomes).toHaveLength(10);
    expect(outcomes[9].color).toBe("gray");
  });

  it("supports Twitch ended-state topPredictors per outcome (R16)", () => {
    const outcome: UnifiedPredictionOutcome = {
      id: "outcome-a",
      title: "Yes",
      color: "blue",
      totalAmount: 250_000,
      userCount: 44,
      topPredictors: [
        { userId: "u1", userName: "blackgio789", amount: 50_000 },
      ],
    };
    expect(outcome.topPredictors?.[0].userName).toBe("blackgio789");
  });
});
