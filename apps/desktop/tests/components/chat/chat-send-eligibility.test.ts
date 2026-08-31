import { describe, expect, it } from "vitest";

import { resolveAccountAgeRequirement } from "@/features/chat/components/chat/chat-send-eligibility";

describe("resolveAccountAgeRequirement", () => {
  const nowMs = Date.parse("2026-08-31T02:00:00Z");

  it("satisfies an inactive policy", () => {
    expect(
      resolveAccountAgeRequirement({ accountCreatedAt: undefined, requiredMinutes: null, nowMs })
    ).toBe("satisfied");
  });

  it("does not infer a restriction without trustworthy viewer data", () => {
    expect(
      resolveAccountAgeRequirement({ accountCreatedAt: undefined, requiredMinutes: 60, nowMs })
    ).toBe("unknown");
    expect(
      resolveAccountAgeRequirement({ accountCreatedAt: "invalid", requiredMinutes: 60, nowMs })
    ).toBe("unknown");
  });

  it("uses the policy boundary exactly", () => {
    expect(
      resolveAccountAgeRequirement({
        accountCreatedAt: "2026-08-31T01:00:01Z",
        requiredMinutes: 60,
        nowMs,
      })
    ).toBe("restricted");
    expect(
      resolveAccountAgeRequirement({
        accountCreatedAt: "2026-08-31T01:00:00Z",
        requiredMinutes: 60,
        nowMs,
      })
    ).toBe("satisfied");
  });
});
