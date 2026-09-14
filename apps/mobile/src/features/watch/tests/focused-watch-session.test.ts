import { describe, expect, it, vi } from "vitest";

import { createFocusedWatchSession } from "../domain/focused-watch-session";
import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtectionPort,
  LivePlaybackSources,
  PlaybackCompatibilityPolicy,
  WatchTarget,
} from "../capabilities/watch";
import { asHlsSourceUri } from "../domain/hls-source";

const target: WatchTarget = {
  channelId: "twitch-1",
  channelName: "live",
  platform: "twitch",
};

const sourceUri = asHlsSourceUri("https://usher.ttvnw.net/api/channel/hls/live.m3u8")!;

function protection(): FocusedPlaybackProtectionPort {
  return {
    acquire: () => ({ release() {} }),
    snapshot: () => ({ kind: "normal" }),
    subscribe: () => () => undefined,
  };
}

function sources(
  resolve: LivePlaybackSources["twitch"]["resolve"] = async () => ({
    integration: "twitch-gql-usher",
    kind: "resolved",
    sourceUri,
  }),
): LivePlaybackSources {
  return {
    kick: {
      integration: "kick-v1-playback-url",
      platform: "kick",
      resolve: async () => ({
        failure: { detail: "unused", kind: "channel-offline" },
        integration: "kick-v1-playback-url",
        kind: "unavailable",
      }),
    },
    twitch: {
      integration: "twitch-gql-usher",
      platform: "twitch",
      resolve,
    },
  };
}

function playbackPort(
  overrides: Partial<FocusedPlaybackPort> = {},
): FocusedPlaybackPort & { ended: string[] } {
  const ended: string[] = [];
  return {
    ended,
    async start({ sessionId }) {
      return {
        kind: "started",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    async end(sessionId) {
      ended.push(sessionId);
      return { kind: "missing", sessionId };
    },
    subscribe: () => () => undefined,
    ...overrides,
  };
}

describe("focused watch session", () => {
  it("fails closed when a signed policy omits the integration", async () => {
    const policy: PlaybackCompatibilityPolicy = {
      read: async () => ({ kind: "disabled", reason: "not-allowed" }),
    };
    const playback = playbackPort();
    const session = createFocusedWatchSession({
      playback,
      policy,
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    const result = await session.start(target);
    expect(result).toMatchObject({
      failure: { kind: "compatibility-disabled", reason: "not-allowed" },
      kind: "failed",
    });
    expect(session.snapshot(target).kind).toBe("failed");
  });

  it("starts a native session after policy and source resolve", async () => {
    const session = createFocusedWatchSession({
      playback: playbackPort(),
      policy: { read: async () => ({ kind: "enabled", sequence: 2 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    await expect(session.start(target)).resolves.toMatchObject({
      kind: "started",
      session: { sessionId: "watch:1" },
    });
    expect(session.snapshot(target)).toMatchObject({
      kind: "active",
      session: { pictureInPictureEligible: false, sessionId: "watch:1" },
    });
  });

  it("does not let a stale end stop a newer session", async () => {
    const playback = playbackPort();
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: {
        create: vi
          .fn()
          .mockReturnValueOnce("watch:a")
          .mockReturnValueOnce("watch:b"),
      },
      sources: sources(),
    });
    await session.start(target);
    const other: WatchTarget = {
      channelId: "twitch-2",
      channelName: "other",
      platform: "twitch",
    };
    await session.start(other);
    await session.leave(target);
    expect(session.snapshot(other).kind).toBe("active");
    expect(playback.ended).toContain("watch:a");
    expect(playback.ended).not.toContain("watch:b");
  });
});
