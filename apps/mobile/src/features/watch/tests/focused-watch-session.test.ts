import { describe, expect, it, vi } from "vitest";

import { createFocusedWatchSession } from "../domain/focused-watch-session";
import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtectionPort,
  LivePlaybackSources,
  NativePlaybackEvent,
  PlaybackCompatibilityPolicy,
  WatchTarget,
} from "../capabilities/watch";
import { asHlsSourceUri } from "../domain/hls-source";
import { twitchHlsRequestHeaders } from "../domain/hls-request-headers";

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
    requestHeaders: twitchHlsRequestHeaders(),
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
    enterPictureInPicture: async (sessionId) => ({
      kind: "unsupported" as const,
      failure: {
        code: "OPERATION_UNSUPPORTED" as const,
        detail: "PiP is stubbed in this test.",
      },
    }),
    listQualities: async (sessionId) => ({
      kind: "listed" as const,
      catalog: { qualities: ["auto"], selected: "auto", sessionId },
    }),
    seekTo: async (sessionId) => ({
      kind: "applied" as const,
      session: { pictureInPictureEligible: false, sessionId },
    }),
    setMuted: async (sessionId) => ({
      kind: "applied" as const,
      session: { pictureInPictureEligible: false, sessionId },
    }),
    setPlaying: async (sessionId) => ({
      kind: "applied" as const,
      session: { pictureInPictureEligible: false, sessionId },
    }),
    setQuality: async (sessionId, quality) => ({
      kind: "listed" as const,
      catalog: { qualities: ["auto"], selected: quality, sessionId },
    }),
    setVolume: async (sessionId) => ({
      kind: "applied" as const,
      session: { pictureInPictureEligible: false, sessionId },
    }),
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
    const started: {
      readonly requestHeaders: Readonly<Record<string, string>>;
      readonly sessionId: string;
      readonly sourceUri: string;
    }[] = [];
    const session = createFocusedWatchSession({
      playback: playbackPort({
        async start(input) {
          started.push(input);
          return {
            kind: "started",
            session: {
              pictureInPictureEligible: false,
              sessionId: input.sessionId,
            },
          };
        },
      }),
      policy: { read: async () => ({ kind: "enabled", sequence: 2 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    await expect(session.start(target)).resolves.toMatchObject({
      kind: "started",
      session: { sessionId: "watch:1" },
    });
    expect(started).toEqual([
      {
        requestHeaders: twitchHlsRequestHeaders(),
        sessionId: "watch:1",
        sourceUri,
      },
    ]);
    expect(session.snapshot(target)).toMatchObject({
      kind: "active",
      session: { pictureInPictureEligible: false, sessionId: "watch:1" },
    });
  });

  it("starts Twitch playback with the filter request", async () => {
    const requests: { filtering?: { mode: string; platform: string } }[] = [];
    const playback = playbackPort({
      start: async (request) => {
        requests.push(request);
        return {
          kind: "started",
          session: {
            pictureInPictureEligible: false,
            sessionId: request.sessionId,
          },
        };
      },
    });
    const session = createFocusedWatchSession({
      filtering: {
        effective: async () => ({
          enabled: true,
          mode: "strip",
          platform: "twitch",
        }),
      },
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    await session.start(target);
    expect(requests[0]?.filtering).toEqual({
      enabled: true,
      mode: "strip",
      platform: "twitch",
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

  it("returns the same peek and ready snapshot objects until the session changes", async () => {
    const session = createFocusedWatchSession({
      playback: playbackPort(),
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    expect(session.peek()).toBe(session.peek());
    expect(session.snapshot(target)).toBe(session.snapshot(target));
    await session.start(target);
    expect(session.peek()).toBe(session.peek());
    expect(session.snapshot(target)).toBe(session.snapshot(target));
    const beforeConceal = session.peek();
    session.conceal();
    expect(session.peek()).not.toBe(beforeConceal);
    expect(session.peek()).toBe(session.peek());
  });

  it("conceals an active session into the mini-player without ending playback", async () => {
    const playback = playbackPort();
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    await session.start(target);
    session.conceal();
    expect(session.peek()).toMatchObject({
      kind: "active",
      presentation: { presentation: "mini" },
    });
    expect(playback.ended).toEqual([]);
    await session.dismiss();
    expect(playback.ended).toEqual(["watch:1"]);
    expect(session.peek().kind).toBe("idle");
  });

  it("refreshes listed qualities once native playback is playing", async () => {
    let emit: ((event: NativePlaybackEvent) => void) | undefined;
    const playback = playbackPort({
      listQualities: async (sessionId) => ({
        kind: "listed",
        catalog: {
          qualities: ["auto", "720p"],
          selected: "auto",
          sessionId,
        },
      }),
      subscribe: (listener) => {
        emit = listener;
        return () => {
          emit = undefined;
        };
      },
    });
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    await session.start(target);
    emit?.({ kind: "playing", sessionId: "watch:1" });
    await Promise.resolve();
    await Promise.resolve();
    expect(session.peek()).toMatchObject({
      kind: "active",
      qualities: ["auto", "720p"],
      quality: "auto",
    });
  });

  it("marks Picture-in-Picture unavailable without ending the session", async () => {
    const playback = playbackPort();
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    await session.start(target);
    await expect(session.requestPictureInPicture()).resolves.toMatchObject({
      kind: "unsupported",
    });
    expect(session.peek()).toMatchObject({
      kind: "active",
      presentation: { pip: "unavailable", presentation: "watch" },
    });
    expect(playback.ended).toEqual([]);
  });

  // Guards: tapping a still-pinned PiP window must not restore Watch chrome inside the system surface
  it("restores Watch only after native Picture-in-Picture actually exits", async () => {
    let emit: ((event: NativePlaybackEvent) => void) | undefined;
    const playback = playbackPort({
      enterPictureInPicture: async (sessionId) => ({
        kind: "entered",
        session: { pictureInPictureEligible: true, sessionId },
      }),
      subscribe: (listener) => {
        emit = listener;
        return () => {
          emit = undefined;
        };
      },
    });
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    await session.start(target);
    await session.requestPictureInPicture();
    expect(session.peek()).toMatchObject({
      kind: "active",
      presentation: { pip: "active", presentation: "pip" },
    });
    emit?.({ kind: "picture-in-picture-exited", sessionId: "watch:1" });
    expect(session.peek()).toMatchObject({
      kind: "active",
      presentation: { pip: "returned", presentation: "watch" },
    });
    expect(playback.ended).toEqual([]);
  });

  it("routes recorded Watch targets to recorded sources and seeks", async () => {
    const started: string[] = [];
    const seeks: number[] = [];
    const recorded = {
      kickVideo: {
        integration: "kick-v2-video" as const,
        platform: "kick" as const,
        resolve: async () => ({
          failure: { detail: "unused", kind: "invalid-response" as const },
          integration: "kick-v2-video" as const,
          kind: "unavailable" as const,
        }),
      },
      twitchClip: {
        integration: "twitch-gql-clip" as const,
        platform: "twitch" as const,
        resolve: async () => ({
          failure: { detail: "unused", kind: "invalid-response" as const },
          integration: "twitch-gql-clip" as const,
          kind: "unavailable" as const,
        }),
      },
      twitchVideo: {
        integration: "twitch-gql-vod" as const,
        platform: "twitch" as const,
        resolve: async () => ({
          integration: "twitch-gql-vod" as const,
          kind: "resolved" as const,
          requestHeaders: twitchHlsRequestHeaders(),
          sourceUri,
        }),
      },
    };
    const session = createFocusedWatchSession({
      playback: playbackPort({
        async start(input) {
          started.push(input.sourceUri);
          return {
            kind: "started",
            session: {
              pictureInPictureEligible: false,
              sessionId: input.sessionId,
            },
          };
        },
        async seekTo(_sessionId, positionMs) {
          seeks.push(positionMs);
          return {
            kind: "applied",
            session: { pictureInPictureEligible: false, sessionId: "watch:1" },
          };
        },
      }),
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      recorded,
      sessionIds: { create: () => "watch:1" },
      sources: sources(async () => {
        throw new Error("live source must not run for recordings");
      }),
    });
    const vod: WatchTarget = {
      ...target,
      media: {
        durationSeconds: 120,
        id: "123",
        kind: "video",
        title: "Archive",
      },
    };
    await expect(session.start(vod)).resolves.toMatchObject({ kind: "started" });
    expect(started).toEqual([sourceUri]);
    await session.seekTo(10_000);
    expect(seeks).toEqual([10_000]);
  });
});
