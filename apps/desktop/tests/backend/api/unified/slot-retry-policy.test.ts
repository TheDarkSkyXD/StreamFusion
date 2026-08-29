import { describe, expect, it } from "vitest";

import {
  decideSlotRetryOutcome,
  SLOT_RETRY_WINDOW_MS,
} from "@backend/api/unified/slot-retry-policy";

// Guards: slice 06 of renderer-OOM PRD (#51, issue #57). The slot crash
// recovery policy is a pure function exhaustively testable against the PRD's
// pinned behavior: first crash in a 5-min window → silent rebuild; second
// crash in the same window → user-facing retry affordance.

const NOW = 1_700_000_000_000;

describe("decideSlotRetryOutcome", () => {
  it("returns 'silent-retry' on the first crash in the window", () => {
    expect(decideSlotRetryOutcome([NOW], NOW)).toBe("silent-retry");
  });

  it("returns 'affordance' on the second crash in the window", () => {
    expect(decideSlotRetryOutcome([NOW - 1000, NOW], NOW)).toBe("affordance");
  });

  it("returns 'affordance' on three or more crashes in the window", () => {
    expect(
      decideSlotRetryOutcome([NOW - 60_000, NOW - 30_000, NOW], NOW)
    ).toBe("affordance");
    expect(
      decideSlotRetryOutcome(
        [NOW - 240_000, NOW - 180_000, NOW - 120_000, NOW - 60_000, NOW],
        NOW
      )
    ).toBe("affordance");
  });

  it("ignores crashes outside the rolling window — only recent crashes count", () => {
    // A crash 6 minutes ago, plus a fresh one now → still only 1 in window.
    const old = NOW - SLOT_RETRY_WINDOW_MS - 1000;
    expect(decideSlotRetryOutcome([old, NOW], NOW)).toBe("silent-retry");
  });

  it("treats a crash exactly at the window boundary as in-window", () => {
    // crashTimestamp == now - SLOT_RETRY_WINDOW_MS  →  cutoff is exactly that
    // value, comparison is `>= cutoff` so it counts.
    const boundary = NOW - SLOT_RETRY_WINDOW_MS;
    expect(decideSlotRetryOutcome([boundary, NOW], NOW)).toBe("affordance");
  });

  it("treats a crash 1ms before the window boundary as out-of-window", () => {
    const justOutside = NOW - SLOT_RETRY_WINDOW_MS - 1;
    expect(decideSlotRetryOutcome([justOutside, NOW], NOW)).toBe("silent-retry");
  });

  it("handles an empty crash list as 'silent-retry' (defensive — should never be called pre-crash)", () => {
    // Defined for the edge case where a caller asks without yet recording
    // the crash. The policy contract says recent <= 1 → silent-retry.
    expect(decideSlotRetryOutcome([], NOW)).toBe("silent-retry");
  });

  it("does not mutate its input array (pure)", () => {
    const input = [NOW - 1000, NOW];
    const snapshot = [...input];
    decideSlotRetryOutcome(input, NOW);
    expect(input).toEqual(snapshot);
  });

  it("SLOT_RETRY_WINDOW_MS is exactly 5 minutes (PRD pin)", () => {
    expect(SLOT_RETRY_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});
