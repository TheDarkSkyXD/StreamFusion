import { describe, expect, it } from "vitest";

import { parsePredictionEvent } from "@/backend/services/chat/twitch-hermes-client";

const CHANNEL_ID = "71092938"; // xQc, arbitrary

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
    expect(result?.status).toBe("ACTIVE");
    expect(result?.title).toBe("Who wins next game?");
    expect(result?.outcomes).toHaveLength(2);
    expect(result?.outcomes[0].color).toBe("blue");
    expect(result?.outcomes[1].color).toBe("pink");
    expect(result?.winningOutcomeId).toBeNull();
    expect(result?.predictionWindowSeconds).toBe(120);
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
    const result = parsePredictionEvent(activePayload({ status: "LOCKED" }), CHANNEL_ID);
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
    const result = parsePredictionEvent(activePayload({ status: "WAT" }), CHANNEL_ID);
    expect(result).toBeNull();
  });

  it("returns null when outcomes array is empty", () => {
    const result = parsePredictionEvent(activePayload({ outcomes: [] }), CHANNEL_ID);
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
