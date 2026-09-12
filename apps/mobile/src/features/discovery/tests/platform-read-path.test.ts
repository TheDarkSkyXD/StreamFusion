import { describe, expect, it } from "vitest";

import {
  followedStreamsPath,
  selectPlatformReadPath,
} from "../domain/platform-read-path";

describe("selectPlatformReadPath", () => {
  it("uses a direct official read when a user token is ready", () => {
    expect(
      selectPlatformReadPath({
        installation: { kind: "none" },
        network: "online",
        platform: "twitch",
        userToken: { accessToken: "user", kind: "ready" },
      }),
    ).toEqual({ kind: "direct", platform: "twitch" });
  });

  it("uses Relay when signed out and an installation credential is ready", () => {
    expect(
      selectPlatformReadPath({
        installation: { credential: "install", kind: "ready" },
        network: "online",
        platform: "kick",
        userToken: { kind: "none" },
      }),
    ).toEqual({ kind: "relay", platform: "kick" });
  });

  it("keeps auth-lost catalog on Relay when an installation exists", () => {
    expect(
      selectPlatformReadPath({
        installation: { credential: "install", kind: "ready" },
        network: "online",
        platform: "twitch",
        userToken: { kind: "auth-lost" },
      }),
    ).toEqual({ kind: "relay", platform: "twitch" });
  });

  it("uses Relay for signed-out catalog reads without an installation", () => {
    expect(
      selectPlatformReadPath({
        installation: { kind: "none" },
        network: "online",
        platform: "twitch",
        userToken: { kind: "none" },
      }),
    ).toEqual({ kind: "relay", platform: "twitch" });
  });

  it("does not send followed streams to Relay when signed out", () => {
    expect(
      followedStreamsPath({
        platform: "twitch",
        userToken: { kind: "none" },
      }),
    ).toEqual({
      kind: "unavailable",
      platform: "twitch",
      reason: "signed-out-login-required",
    });
  });
});
