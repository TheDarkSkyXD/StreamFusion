import { describe, expect, it } from "vitest";

import {
  followedStreamsPath,
  selectPlatformReadPath,
  selectSearchReadPath,
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

  it("uses guest catalogs when signed out even if an installation exists", () => {
    expect(
      selectPlatformReadPath({
        installation: { credential: "install", kind: "ready" },
        network: "online",
        platform: "kick",
        userToken: { kind: "none" },
      }),
    ).toEqual({ kind: "guest", platform: "kick" });
  });

  it("keeps auth-lost catalog on guest public reads", () => {
    expect(
      selectPlatformReadPath({
        installation: { credential: "install", kind: "ready" },
        network: "online",
        platform: "twitch",
        userToken: { kind: "auth-lost" },
      }),
    ).toEqual({ kind: "guest", platform: "twitch" });
  });

  it("uses guest public catalogs when signed out without an installation", () => {
    expect(
      selectPlatformReadPath({
        installation: { kind: "none" },
        network: "online",
        platform: "twitch",
        userToken: { kind: "none" },
      }),
    ).toEqual({ kind: "guest", platform: "twitch" });
    expect(
      selectPlatformReadPath({
        installation: { kind: "none" },
        network: "online",
        platform: "kick",
        userToken: { kind: "none" },
      }),
    ).toEqual({ kind: "guest", platform: "kick" });
  });

  it("keeps guest Search available when signed out, including with an installation", () => {
    expect(
      selectSearchReadPath({
        installation: { kind: "none" },
        network: "online",
        platform: "twitch",
        userToken: { kind: "none" },
      }),
    ).toEqual({ kind: "guest", platform: "twitch" });
    expect(
      selectSearchReadPath({
        installation: { credential: "install", kind: "ready" },
        network: "online",
        platform: "kick",
        userToken: { kind: "auth-lost" },
      }),
    ).toEqual({ kind: "guest", platform: "kick" });
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
