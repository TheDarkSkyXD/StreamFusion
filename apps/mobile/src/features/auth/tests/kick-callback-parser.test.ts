import { describe, expect, it } from "vitest";

import { KICK_ANDROID_REDIRECT_URI } from "@streamfusion/core/auth";

import { parseKickCallbackUrl } from "../adapters/kick/kick-callback-parser";

describe("parseKickCallbackUrl", () => {
  it("accepts the exact Android callback and drops other hosts", () => {
    expect(
      parseKickCallbackUrl(
        `${KICK_ANDROID_REDIRECT_URI}?code=kick-code&state=live-state`,
        1_000,
      ),
    ).toEqual({
      code: "kick-code",
      error: null,
      receivedAtEpochMs: 1_000,
      redirectUri: KICK_ANDROID_REDIRECT_URI,
      state: "live-state",
    });
    expect(
      parseKickCallbackUrl(
        "https://attacker.example/auth/kick/android/callback?code=x&state=y",
        1_000,
      ),
    ).toBeNull();
  });
});
