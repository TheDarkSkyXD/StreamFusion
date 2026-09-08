import {
  twitchAccountId,
  type TwitchDeviceAuthorizationGateway,
} from "@streamfusion/core/auth";

export const DEVELOPMENT_TWITCH_CLIENT_ID = "streamfusion-development-fixture";
// 2s initial cadence, then the fixture's first transient result doubles it to 4s:
// poll 16 cannot occur before 62s (2s + 15 * 4s).
const DEVELOPMENT_FIXTURE_AUTHORIZATION_POLL = 16;

export function createDevelopmentTwitchAuthFixture(): TwitchDeviceAuthorizationGateway {
  if (!__DEV__)
    throw new Error("The Twitch authentication fixture is development-only.");
  let polls = 0;
  return {
    request: async () => {
      polls = 0;
      return {
        deviceCode: "development-device-code",
        userCode: "SF-145",
        verificationUri: "https://www.twitch.tv/activate",
        expiresInSeconds: 600,
        intervalSeconds: 2,
      };
    },
    poll: async () => {
      polls += 1;
      if (polls === 1) return { kind: "transient-failure" };
      return polls < DEVELOPMENT_FIXTURE_AUTHORIZATION_POLL
        ? { kind: "pending" }
        : {
            kind: "authorized",
            accessToken: "development-access-token",
            refreshToken: "development-refresh-token",
            expiresInSeconds: 3_600,
            scopes: ["chat:read"],
          };
    },
    validate: async () => ({
      kind: "valid",
      validation: {
        clientId: DEVELOPMENT_TWITCH_CLIENT_ID,
        expiresInSeconds: 3_600,
        login: "streamfusion_fixture",
        scopes: ["chat:read"],
        userId: twitchAccountId("development-account"),
      },
    }),
    loadAccount: async () => ({
      kind: "found",
      account: {
        id: twitchAccountId("development-account"),
        login: "streamfusion_fixture",
        displayName: "Twitch development fixture",
        profileImageUrl: null,
      },
    }),
    refresh: async () => ({
      kind: "refreshed",
      accessToken: "development-refreshed-access-token",
      refreshToken: "development-refreshed-refresh-token",
      expiresInSeconds: 3_600,
      scopes: ["chat:read"],
    }),
  };
}
