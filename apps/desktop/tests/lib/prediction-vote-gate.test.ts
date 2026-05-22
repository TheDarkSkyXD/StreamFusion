import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetForTests,
  acquire,
  clearForChannel,
  clearForPrediction,
  isInFlight,
  predictionVoteGateKey,
  release,
} from "@/lib/prediction-vote-gate";

beforeEach(() => {
  __resetForTests();
});

describe("predictionVoteGateKey", () => {
  it("formats the key as platform:slug:predictionId", () => {
    expect(predictionVoteGateKey("twitch", "fitzbro", "pred-1")).toBe("twitch:fitzbro:pred-1");
    expect(predictionVoteGateKey("kick", "ramee", "pred-2")).toBe("kick:ramee:pred-2");
  });
});

describe("acquire / release / isInFlight", () => {
  it("first acquire returns true and marks the key in-flight", () => {
    const key = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    expect(isInFlight(key)).toBe(false);
    expect(acquire(key)).toBe(true);
    expect(isInFlight(key)).toBe(true);
  });

  it("second acquire of the same key returns false (gate blocks duplicate)", () => {
    const key = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    expect(acquire(key)).toBe(true);
    expect(acquire(key)).toBe(false);
  });

  it("release frees the key so a subsequent acquire succeeds", () => {
    const key = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    acquire(key);
    release(key);
    expect(isInFlight(key)).toBe(false);
    expect(acquire(key)).toBe(true);
  });

  it("release is idempotent — no throw when releasing a non-held key", () => {
    const key = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    expect(() => release(key)).not.toThrow();
  });

  it("acquire is independent across different keys", () => {
    const a = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    const b = predictionVoteGateKey("twitch", "fitzbro", "pred-2");
    const c = predictionVoteGateKey("kick", "ramee", "pred-1");
    expect(acquire(a)).toBe(true);
    expect(acquire(b)).toBe(true);
    expect(acquire(c)).toBe(true);
    expect(isInFlight(a)).toBe(true);
    expect(isInFlight(b)).toBe(true);
    expect(isInFlight(c)).toBe(true);
  });
});

describe("clearForPrediction", () => {
  it("removes every key whose predictionId segment matches", () => {
    const twitch = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    const kick = predictionVoteGateKey("kick", "ramee", "pred-1");
    const other = predictionVoteGateKey("twitch", "fitzbro", "pred-other");

    acquire(twitch);
    acquire(kick);
    acquire(other);

    clearForPrediction("pred-1");

    expect(isInFlight(twitch)).toBe(false);
    expect(isInFlight(kick)).toBe(false);
    expect(isInFlight(other)).toBe(true);
  });

  it("preserves entries whose predictionId differs even when slug matches", () => {
    const a = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    const b = predictionVoteGateKey("twitch", "fitzbro", "pred-2");
    acquire(a);
    acquire(b);
    clearForPrediction("pred-1");
    expect(isInFlight(a)).toBe(false);
    expect(isInFlight(b)).toBe(true);
  });

  it("no-op when no key matches", () => {
    const a = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    acquire(a);
    clearForPrediction("does-not-exist");
    expect(isInFlight(a)).toBe(true);
  });

  it("handles predictionIds that contain colons (split on first/last colon defensively)", () => {
    // Hypothetical: a real predictionId is `prefix:tail`. The gate must
    // still treat the whole third segment as the predictionId.
    const key = "twitch:fitzbro:prefix:tail";
    acquire(key);
    clearForPrediction("prefix:tail");
    expect(isInFlight(key)).toBe(false);
  });
});

describe("clearForChannel", () => {
  it("removes every key whose slug segment matches", () => {
    const a = predictionVoteGateKey("twitch", "fitzbro", "pred-1");
    const b = predictionVoteGateKey("twitch", "fitzbro", "pred-2");
    const other = predictionVoteGateKey("twitch", "someone-else", "pred-3");

    acquire(a);
    acquire(b);
    acquire(other);

    clearForChannel("fitzbro");

    expect(isInFlight(a)).toBe(false);
    expect(isInFlight(b)).toBe(false);
    expect(isInFlight(other)).toBe(true);
  });

  it("does not cross-clear entries with a similar but different slug", () => {
    const a = predictionVoteGateKey("twitch", "fitz", "pred-1");
    const b = predictionVoteGateKey("twitch", "fitzbro", "pred-2");
    acquire(a);
    acquire(b);
    clearForChannel("fitz");
    expect(isInFlight(a)).toBe(false);
    expect(isInFlight(b)).toBe(true);
  });

  it("only affects the matched slug across platforms", () => {
    // Same slug on different platforms — clearForChannel removes both because
    // the slug match doesn't depend on platform. This is intentional: callers
    // pass the platform's own slug, which is unique within that platform.
    const twitch = predictionVoteGateKey("twitch", "ramee", "pred-1");
    const kick = predictionVoteGateKey("kick", "ramee", "pred-2");
    acquire(twitch);
    acquire(kick);
    clearForChannel("ramee");
    expect(isInFlight(twitch)).toBe(false);
    expect(isInFlight(kick)).toBe(false);
  });
});
