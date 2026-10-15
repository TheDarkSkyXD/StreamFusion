import { describe, expect, it } from "vitest";
import { TWITCH_APP_CLIENT_ID } from "@streamfusion/core/auth";
import { parseTwitchClientConfiguration } from "../adapters/twitch/twitch-client-config";

describe("mobile Twitch client configuration", () => {
  it.each([undefined, "", " \t\n"])(
    "uses the bundled public client when the release override is %j",
    (override) => {
      expect(parseTwitchClientConfiguration(override)).toEqual({
        clientId: TWITCH_APP_CLIENT_ID,
      });
    },
  );

  it("uses a configured public client override", () => {
    expect(parseTwitchClientConfiguration(" alternate-public-client ")).toEqual({
      clientId: "alternate-public-client",
    });
  });
});
