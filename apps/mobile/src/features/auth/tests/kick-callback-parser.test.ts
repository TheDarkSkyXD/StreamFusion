import { describe, expect, it } from "vitest";

import { KICK_ANDROID_REDIRECT_URI } from "@streamfusion/core/auth";

import { parseKickCallbackUrl } from "../adapters/kick/kick-callback-parser";

describe("parseKickCallbackUrl", () => {
  const state = `sf1.d.${"A".repeat(43)}`;
  it("accepts the exact Android callback and drops other hosts", () => {
    expect(
      parseKickCallbackUrl(
        `${KICK_ANDROID_REDIRECT_URI}?code=kick-code&state=${state}`,
        1_000,
      ),
    ).toEqual({
      code: "kick-code",
      error: null,
      receivedAtEpochMs: 1_000,
      redirectUri: KICK_ANDROID_REDIRECT_URI,
      state,
    });
    expect(
      parseKickCallbackUrl(
        "https://attacker.example/auth/kick/android/callback?code=x&state=y",
        1_000,
      ),
    ).toBeNull();
  });

  it("normalizes the two app return addresses and rejects ambiguous callbacks", () => {
    for (const scheme of ["streamfusion-development", "streamfusion"]) {
      expect(
        parseKickCallbackUrl(
          `${scheme}://auth/kick/callback?code=abc&state=${state}`,
          2,
        ),
      ).toEqual({
        code: "abc",
        error: null,
        state,
        receivedAtEpochMs: 2,
        redirectUri: KICK_ANDROID_REDIRECT_URI,
      });
    }
    for (const url of [
      `streamfusion://user@auth/kick/callback?code=x&state=${state}`,
      `streamfusion://auth:123/kick/callback?code=x&state=${state}`,
      `streamfusion://auth/kick/callback/extra?code=x&state=${state}`,
      `streamfusion://auth/kick/callback?code=x&state=${state}#fragment`,
      `streamfusion://auth/kick/callback?code=x&code=y&state=${state}`,
      `streamfusion://auth/kick/callback?code=x&state=${state}&state=${state}`,
      `streamfusion://auth/kick/callback?code=x&error=denied&state=${state}`,
      `streamfusion://auth/kick/callback?code=x&state=unstructured`,
      `streamfusion://auth/kick/callback?code=%GG&state=${state}`,
    ])
      expect(parseKickCallbackUrl(url, 2)).toBeNull();
    expect(
      parseKickCallbackUrl(
        `streamfusion-development://auth/kick/callback?error=access_denied&error_description=No+thanks&state=${state}`,
        2,
      ),
    ).toEqual({
      code: null,
      error: "access_denied",
      state,
      receivedAtEpochMs: 2,
      redirectUri: KICK_ANDROID_REDIRECT_URI,
    });
  });
});
