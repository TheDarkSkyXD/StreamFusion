import { describe, expect, it } from "vitest";

import { normalizeKickPrediction } from "@backend/services/chat/kick-prediction-normalizer";
import type { KickPredictionPayload } from "@backend/api/platforms/kick/kick-types";

// Guards: Kick prediction wire → UnifiedPrediction mapping — state clamp
// (ACTIVE / LOCKED / RESOLVED / CANCELED, deleted → CANCELED), outcomes
// color always null on Kick (icon colors picked at render time on
// kick.com's side, not in the payload), `user_vote` → viewerOutcomeId /
// viewerStake mapping, and the synthesized `endedAt` (created_at +
// duration) for non-ACTIVE statuses. channelId AND channelSlug must both
// be populated from opts so the multiview filter's dual-ID fallback works.

function makeRaw(overrides: Partial<KickPredictionPayload> = {}): KickPredictionPayload {
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

describe("normalizeKickPrediction", () => {
  it("maps an ACTIVE prediction with the canonical channelId + slug", () => {
    const result = normalizeKickPrediction(makeRaw(), {
      channelId: "12345",
      channelSlug: "ramee",
    });

    expect(result.id).toBe("pred-1");
    expect(result.platform).toBe("kick");
    expect(result.status).toBe("ACTIVE");
    expect(result.channelId).toBe("12345");
    expect(result.channelSlug).toBe("ramee");
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes[0]).toEqual({
      id: "o1",
      title: "Yes",
      color: null,
      totalAmount: 1000,
      userCount: 0,
    });
    expect(result.endedAt).toBeNull();
    expect(result.winningOutcomeId).toBeNull();
    expect(result.viewerOutcomeId).toBeNull();
    expect(result.viewerStake).toBeNull();
  });

  it("clamps lowercase `active` state to uppercase ACTIVE", () => {
    const result = normalizeKickPrediction(makeRaw({ state: "active" }), {
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(result.status).toBe("ACTIVE");
  });

  it("maps `LOCKED` state through unchanged", () => {
    const result = normalizeKickPrediction(makeRaw({ state: "LOCKED" }), {
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(result.status).toBe("LOCKED");
  });

  it("maps `RESOLVED` state and populates winningOutcomeId", () => {
    const result = normalizeKickPrediction(
      makeRaw({ state: "resolved", winning_outcome_id: "o1" }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(result.status).toBe("RESOLVED");
    expect(result.winningOutcomeId).toBe("o1");
  });

  it("maps `deleted` state to CANCELED (terminal non-winning)", () => {
    const result = normalizeKickPrediction(makeRaw({ state: "deleted" }), {
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(result.status).toBe("CANCELED");
  });

  it("falls back to ACTIVE for an unrecognized state string (defensive)", () => {
    const result = normalizeKickPrediction(makeRaw({ state: "wat" }), {
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(result.status).toBe("ACTIVE");
  });

  it("populates viewerOutcomeId + viewerStake from user_vote when present", () => {
    const result = normalizeKickPrediction(
      makeRaw({
        user_vote: { outcome_id: "o1", total_vote_amount: 250 },
      }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(result.viewerOutcomeId).toBe("o1");
    expect(result.viewerStake).toBe(250);
  });

  it("leaves viewerOutcomeId / viewerStake null when user_vote is missing (anonymous or non-voting)", () => {
    const result = normalizeKickPrediction(makeRaw({ user_vote: undefined }), {
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(result.viewerOutcomeId).toBeNull();
    expect(result.viewerStake).toBeNull();
  });

  it("synthesizes endedAt = created_at + duration when status != ACTIVE", () => {
    const result = normalizeKickPrediction(
      makeRaw({
        state: "RESOLVED",
        winning_outcome_id: "o1",
        created_at: "2026-05-22T19:00:00.000Z",
        duration: 120, // 2 minutes
      }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(result.endedAt).toBe("2026-05-22T19:02:00.000Z");
  });

  it("returns endedAt: null when status is ACTIVE regardless of duration", () => {
    const result = normalizeKickPrediction(
      makeRaw({ state: "ACTIVE", duration: 999 }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(result.endedAt).toBeNull();
  });

  it("returns endedAt: null when created_at is unparseable", () => {
    const result = normalizeKickPrediction(
      makeRaw({
        state: "RESOLVED",
        winning_outcome_id: "o1",
        created_at: "not-a-date",
        duration: 60,
      }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(result.endedAt).toBeNull();
  });

  it("always sets outcome color to null (Kick does not include color in payload)", () => {
    const result = normalizeKickPrediction(makeRaw(), {
      channelId: "12345",
      channelSlug: "ramee",
    });
    for (const outcome of result.outcomes) {
      expect(outcome.color).toBeNull();
    }
  });

  it("treats winning_outcome_id of empty string as null (defensive)", () => {
    const result = normalizeKickPrediction(
      makeRaw({ state: "RESOLVED", winning_outcome_id: "" }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(result.winningOutcomeId).toBeNull();
  });

  it("preserves predictionWindowSeconds from duration", () => {
    const result = normalizeKickPrediction(makeRaw({ duration: 300 }), {
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(result.predictionWindowSeconds).toBe(300);
  });
});
