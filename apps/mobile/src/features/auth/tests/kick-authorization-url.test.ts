import { describe, expect, it, vi } from "vitest";
import { KICK_ANDROID_REDIRECT_URI } from "@streamfusion/core/auth";
import { createKickPkceAuthorization } from "../adapters/kick/kick-authorization-url";

vi.mock("../../../../modules/streamfusion-native-contracts/src/storage", () => ({
  requireStorageModule: () => ({ randomBytes: (count: number) => "01".repeat(count) }),
}));

vi.mock("../../../../modules/streamfusion-native-contracts/src/platform", () => ({
  getPlatformModule: () => ({ sha256: async () => "YWJjZA==" }),
}));

describe("Kick PKCE authorization", () => {
  it.each([
    ["development", "d"],
    ["production", "p"],
  ] as const)(
    "uses the %s app channel with the canonical HTTPS redirect",
    async (channel, marker) => {
      const authorization = await createKickPkceAuthorization({
        clientId: "public-kick",
        nowEpochMs: 5_000,
        channel,
      });
      const url = new URL(authorization.authorizeUrl);
      expect(url.searchParams.get("client_id")).toBe("public-kick");
      expect(url.searchParams.get("redirect_uri")).toBe(
        KICK_ANDROID_REDIRECT_URI,
      );
      expect(url.searchParams.get("state")).toBe(authorization.state);
      expect(authorization.state).toMatch(
        new RegExp(`^sf1\\.${marker}\\.[A-Za-z0-9_-]{43}$`),
      );
      expect(authorization.redirectUri).toBe(KICK_ANDROID_REDIRECT_URI);
      expect(authorization.codeVerifier).toHaveLength(64);
    },
  );
});
