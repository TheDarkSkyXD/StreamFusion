import { describe, expect, it } from "vitest";

import {
  KICK_STARTUP_HOVER_PREFETCH_GRACE_MS,
  shouldDeferKickStartupHoverPrefetch,
} from "@/components/stream/stream-card";

describe("StreamCard startup hover prefetch", () => {
  it("defers Kick hover prefetch during startup only", () => {
    expect(shouldDeferKickStartupHoverPrefetch("kick", 1000, 0)).toBe(true);
    expect(shouldDeferKickStartupHoverPrefetch("twitch", 1000, 0)).toBe(false);
    expect(
      shouldDeferKickStartupHoverPrefetch("kick", KICK_STARTUP_HOVER_PREFETCH_GRACE_MS + 1, 0)
    ).toBe(false);
  });
});
