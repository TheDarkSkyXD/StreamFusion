import { afterEach, describe, expect, it, vi } from "vitest";

import { createAdBlockSession } from "@mobile/features/ad-blocking/composition/guest-adblock-session";
import { createTwitchPlaylistProxySession } from "@mobile/features/ad-blocking/composition/guest-twitch-playlist-proxy-session";
import type { PlaybackFilterRequest } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { EffectiveCapabilityPolicyReader } from "@mobile/features/installation-policy/capabilities/installation-policy";
import type { ProductSettingsStore } from "@mobile/features/storage/capabilities/persistence";

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
import { setWatchOrientationControllerForTests } from "../domain/watch-fullscreen-orientation";

const target: WatchTarget = {
  channelId: "twitch-1",
  channelName: "live",
  platform: "twitch",
};

const sourceUri = asHlsSourceUri(
  "https://usher.ttvnw.net/api/channel/hls/live.m3u8",
)!;

afterEach(() => setWatchOrientationControllerForTests(null));

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
      channelName: "live",
      enabled: true,
      mode: "strip",
      platform: "twitch",
    });
  });

  it("wires default-on AdBlockSession strip into Twitch Watch start", async () => {
    const requests: {
      filtering?: { enabled: boolean; mode: string; platform: string };
    }[] = [];
    const settings: ProductSettingsStore = {
      async read() {
        return null;
      },
      async write(_key, _value, _updatedAt) {},
    };
    const policy: EffectiveCapabilityPolicyReader = {
      read: async () => ({
        kind: "enabled",
        sequence: 1,
        verifiedAtEpochMs: 1,
      }),
    };
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
      filtering: createAdBlockSession({ policy, settings }),
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    await session.start(target);
    expect(requests[0]?.filtering).toEqual({
      channelName: "live",
      enabled: true,
      mode: "strip",
      platform: "twitch",
    });
  });

  it("does not invent a Kick playlist filter on Watch start", async () => {
    const requests: { filtering?: { mode: string; platform: string } }[] = [];
    const kickTarget: WatchTarget = {
      channelId: "kick-1",
      channelName: "kicklive",
      platform: "kick",
    };
    const kickUri = asHlsSourceUri(
      "https://fa723fc1b171.cloudfront.net/live.m3u8",
    )!;
    const settings: ProductSettingsStore = {
      async read() {
        return null;
      },
      async write(_key, _value, _updatedAt) {},
    };
    const adPolicy: EffectiveCapabilityPolicyReader = {
      read: async () => ({
        kind: "enabled",
        sequence: 1,
        verifiedAtEpochMs: 1,
      }),
    };
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
      filtering: createAdBlockSession({ policy: adPolicy, settings }),
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:kick" },
      sources: {
        kick: {
          integration: "kick-v1-playback-url",
          platform: "kick",
          resolve: async () => ({
            integration: "kick-v1-playback-url",
            kind: "resolved",
            requestHeaders: {},
            sourceUri: kickUri,
          }),
        },
        twitch: sources().twitch,
      },
    });
    await session.start(kickTarget);
    expect(requests[0]?.filtering).toEqual({
      enabled: true,
      mode: "passthrough",
      platform: "kick",
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

  it("tracks playlist-filter adsDetected for the player adblock shield", async () => {
    let emit: ((event: NativePlaybackEvent) => void) | undefined;
    const playback = playbackPort({
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
    expect(session.peek()).toMatchObject({
      adsDetected: false,
      kind: "active",
    });
    emit?.({
      diagnostic:
        "Ads detected; held without media (desktop unsafe-hold, no backup).",
      kind: "filtering",
      sessionId: "watch:1",
    });
    expect(session.peek()).toMatchObject({ adsDetected: true, kind: "active" });
    emit?.({
      adsDetected: false,
      diagnostic: "No Twitch ad markers in this playlist.",
      kind: "filtering",
      sessionId: "watch:1",
    });
    expect(session.peek()).toMatchObject({
      adsDetected: false,
      kind: "active",
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
      presentation: { pip: "idle", presentation: "mini" },
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
    await expect(session.start(vod)).resolves.toMatchObject({
      kind: "started",
    });
    expect(started).toEqual([sourceUri]);
    await session.seekTo(10_000);
    expect(seeks).toEqual([10_000]);
  });

  it("leaves Twitch VOD and clip playback outside live ad filtering", async () => {
    const settings: ProductSettingsStore = {
      read: async () => null,
      write: async () => undefined,
    };
    const filtering = createAdBlockSession({
      policy: { read: async () => ({ kind: "enabled", sequence: 1, verifiedAtEpochMs: 1 }) },
      settings,
    });
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
          integration: "twitch-gql-clip" as const,
          kind: "resolved" as const,
          requestHeaders: twitchHlsRequestHeaders(),
          sourceUri,
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
    for (const kind of ["video", "clip"] as const) {
      const requests: (PlaybackFilterRequest | undefined)[] = [];
      const session = createFocusedWatchSession({
        filtering,
        playback: playbackPort({
          async start(request) {
            requests.push(request.filtering);
            return {
              kind: "started",
              session: { pictureInPictureEligible: false, sessionId: request.sessionId },
            };
          },
        }),
        policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
        protection: protection(),
        recorded,
        sessionIds: { create: () => `watch:${kind}` },
        sources: sources(async () => { throw new Error("live source must not run for recordings"); }),
      });
      await expect(session.start({
        ...target,
        media: { durationSeconds: 120, id: kind, kind, title: kind },
      })).resolves.toMatchObject({ kind: "started" });
      expect(requests).toEqual([{ enabled: false, mode: "passthrough", platform: "twitch" }]);
    }
  });

  it("falls back across Twitch playlist proxy sources then direct usher", async () => {
    const started: string[] = [];
    const values = new Map<string, string>();
    const settings: ProductSettingsStore = {
      async read(key) {
        return values.get(key) ?? null;
      },
      async write(key, value, _updatedAt) {
        values.set(key, value);
      },
    };
    const playlistProxy = createTwitchPlaylistProxySession({ settings });
    await playlistProxy.save({
      enabled: true,
      sources: [
        {
          addQueryParams: false,
          enabled: true,
          id: "bad",
          url: "https://bad.example/live/$channel",
        },
        {
          addQueryParams: false,
          enabled: true,
          id: "good",
          url: "https://good.example/live/$channel",
        },
      ],
    });
    let sessionCounter = 0;
    const playback = playbackPort({
      async start(request) {
        started.push(request.sourceUri);
        if (request.sourceUri.includes("bad.example")) {
          return {
            failure: { code: "INVOCATION_FAILED", detail: "bad proxy" },
            kind: "unavailable",
          };
        }
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
      playback,
      playlistProxy,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: {
        create: () => {
          sessionCounter += 1;
          return `watch:${sessionCounter}`;
        },
      },
      sources: sources(),
    });
    await expect(session.start(target)).resolves.toMatchObject({
      kind: "started",
    });
    expect(started[0]).toBe("https://bad.example/live/live");
    expect(started[1]).toBe("https://good.example/live/live");
    expect(started).toHaveLength(2);
  });

  it("gives custom strip priority over a legacy enabled proxy", async () => {
    const requests: {
      filtering?: { enabled: boolean; mode: string; platform: string };
      sourceUri: string;
    }[] = [];
    const values = new Map<string, string>();
    const settings: ProductSettingsStore = {
      async read(key) {
        return values.get(key) ?? null;
      },
      async write(key, value, _updatedAt) {
        values.set(key, value);
      },
    };
    const playlistProxy = createTwitchPlaylistProxySession({ settings });
    await playlistProxy.save({
      enabled: true,
      sources: [
        {
          addQueryParams: false,
          enabled: true,
          id: "bad",
          url: "https://bad.example/live/$channel",
        },
      ],
    });
    let sessionCounter = 0;
    const playback = playbackPort({
      async start(request) {
        requests.push({
          filtering: request.filtering,
          sourceUri: request.sourceUri,
        });
        if (request.sourceUri.includes("bad.example")) {
          return {
            failure: { code: "INVOCATION_FAILED", detail: "bad proxy" },
            kind: "unavailable",
          };
        }
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
      filtering: createAdBlockSession({
        policy: {
          read: async () => ({
            kind: "enabled",
            sequence: 1,
            verifiedAtEpochMs: 1,
          }),
        },
        settings,
      }),
      playback,
      playlistProxy,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: {
        create: () => {
          sessionCounter += 1;
          return `watch:proxy-pass:${sessionCounter}`;
        },
      },
      sources: sources(),
    });
    await expect(session.start(target)).resolves.toMatchObject({
      kind: "started",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      filtering: { enabled: true, mode: "strip", platform: "twitch" },
      sourceUri,
    });
  });

  for (const platform of ["twitch", "kick"] as const) {
    it(`refreshes ${platform} in fullscreen with its audio and quality intact`, async () => {
      const watched: WatchTarget = {
        channelId: `${platform}-1`,
        channelName: "live",
        platform,
      };
      const controls: string[] = [];
      const locks: string[] = [];
      setWatchOrientationControllerForTests({
        lockAsync: async (lock) => { locks.push(lock); },
      });
      let sequence = 0;
      const playback = playbackPort({
        setMuted: async (sessionId, value) => {
          controls.push(`mute:${sessionId}:${value}`);
          return { kind: "applied", session: { pictureInPictureEligible: false, sessionId } };
        },
        setVolume: async (sessionId, value) => {
          controls.push(`volume:${sessionId}:${value}`);
          return { kind: "applied", session: { pictureInPictureEligible: false, sessionId } };
        },
        setQuality: async (sessionId, value) => {
          controls.push(`quality:${sessionId}:${value}`);
          return {
            kind: "listed",
            catalog: { qualities: ["auto", "720p"], selected: value, sessionId },
          };
        },
      });
      const kickUri = asHlsSourceUri("https://kick.example/live.m3u8")!;
      const session = createFocusedWatchSession({
        playback,
        policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
        protection: protection(),
        sessionIds: { create: () => `watch:${++sequence}` },
        sources: {
          ...sources(),
          kick: {
            integration: "kick-v1-playback-url",
            platform: "kick",
            resolve: async () => ({
              integration: "kick-v1-playback-url",
              kind: "resolved",
              requestHeaders: {},
              sourceUri: kickUri,
            }),
          },
        },
      });
      await session.start(watched);
      await session.setMuted(true);
      await session.setVolume(0.3);
      await session.setQuality("720p");
      session.enterFullscreen();
      controls.length = 0;

      await expect(session.refresh(watched)).resolves.toMatchObject({
        kind: "started",
        session: { sessionId: "watch:2" },
      });
      expect(controls).toEqual([
        "volume:watch:2:0.3",
        "mute:watch:2:true",
        "quality:watch:2:720p",
      ]);
      expect(playback.ended).toEqual(["watch:1"]);
      expect(session.peek()).toMatchObject({
        kind: "active",
        muted: true,
        presentation: { presentation: "fullscreen" },
        quality: "720p",
        volume: 0.3,
      });
      expect(locks).toEqual(["landscape"]);
    });

    it(`restores portrait when ${platform} fullscreen refresh fails`, async () => {
      const watched: WatchTarget = {
        channelId: `${platform}-1`,
        channelName: "live",
        platform,
      };
      const locks: string[] = [];
      setWatchOrientationControllerForTests({
        lockAsync: async (lock) => { locks.push(lock); },
      });
      let resolves = 0;
      const resolveTwitch: LivePlaybackSources["twitch"]["resolve"] = async () =>
        ++resolves === 1
          ? {
              integration: "twitch-gql-usher",
              kind: "resolved",
              requestHeaders: twitchHlsRequestHeaders(),
              sourceUri,
            }
          : {
              failure: { detail: "Stream URL unavailable", kind: "invalid-response" },
              integration: "twitch-gql-usher",
              kind: "unavailable",
            };
      const resolveKick: LivePlaybackSources["kick"]["resolve"] = async () =>
        ++resolves === 1
          ? {
              integration: "kick-v1-playback-url",
              kind: "resolved",
              requestHeaders: {},
              sourceUri,
            }
          : {
              failure: { detail: "Stream URL unavailable", kind: "invalid-response" },
              integration: "kick-v1-playback-url",
              kind: "unavailable",
            };
      const session = createFocusedWatchSession({
        playback: playbackPort(),
        policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
        protection: protection(),
        sessionIds: { create: () => `watch:${resolves}` },
        sources: {
          ...sources(resolveTwitch),
          kick: {
            integration: "kick-v1-playback-url",
            platform: "kick",
            resolve: resolveKick,
          },
        },
      });
      await session.start(watched);
      session.enterFullscreen();
      await expect(session.refresh(watched)).resolves.toMatchObject({ kind: "failed" });
      expect(session.snapshot(watched).kind).toBe("failed");
      expect(session.peek().kind).toBe("idle");
      expect(locks).toEqual(["landscape", "portrait-up"]);
    });
  }

  it("ends the old native session once when refresh source resolution fails", async () => {
    const released: string[] = [];
    const playback = playbackPort();
    let resolves = 0;
    let sequence = 0;
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: {
        ...protection(),
        acquire: (sessionId) => ({ release: () => { released.push(sessionId); } }),
      },
      sessionIds: { create: () => `watch:${++sequence}` },
      sources: sources(async () =>
        ++resolves === 1
          ? {
              integration: "twitch-gql-usher",
              kind: "resolved",
              requestHeaders: twitchHlsRequestHeaders(),
              sourceUri,
            }
          : {
              failure: { detail: "Stream URL unavailable", kind: "invalid-response" },
              integration: "twitch-gql-usher",
              kind: "unavailable",
            },
      ),
    });
    await session.start(target);
    await expect(session.refresh(target)).resolves.toMatchObject({ kind: "failed" });
    expect(playback.ended).toEqual(["watch:1"]);
    expect(released).toEqual(["watch:1"]);
    expect(session.snapshot(target).kind).toBe("failed");
  });

  it("updates the quality catalog when the current selection is queried again", async () => {
    const playback = playbackPort({
      setQuality: async (sessionId, selected) => ({
        kind: "listed",
        catalog: { qualities: ["auto", "1080p", "720p"], selected, sessionId },
      }),
    });
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    await session.start(target);
    expect(session.peek()).toMatchObject({ quality: "auto", qualities: ["auto"] });
    await session.setQuality("auto");
    expect(session.peek()).toMatchObject({
      quality: "auto",
      qualities: ["auto", "1080p", "720p"],
    });
  });

  it("does not end the old native session twice when dismissed during source resolution", async () => {
    let finishResolution: (() => void) | undefined;
    const released: string[] = [];
    const playback = playbackPort();
    let resolves = 0;
    let sequence = 0;
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: {
        ...protection(),
        acquire: (sessionId) => ({ release: () => { released.push(sessionId); } }),
      },
      sessionIds: { create: () => `watch:${++sequence}` },
      sources: sources(async () => {
        if (++resolves > 1) {
          await new Promise<void>((resolve) => { finishResolution = resolve; });
        }
        return {
          integration: "twitch-gql-usher",
          kind: "resolved",
          requestHeaders: twitchHlsRequestHeaders(),
          sourceUri,
        };
      }),
    });
    await session.start(target);
    const refreshing = session.refresh(target);
    await vi.waitFor(() => expect(finishResolution).toBeDefined());
    await session.dismiss();
    finishResolution?.();
    await expect(refreshing).resolves.toEqual({ kind: "cancelled" });
    expect(playback.ended).toEqual(["watch:1"]);
    expect(released).toEqual(["watch:1"]);
    expect(session.snapshot(target).kind).toBe("ready");
  });

  it("routes controls and native events to the adopted session during refresh", async () => {
    let resolveRestoredVolume: (() => void) | undefined;
    let nativeVolume = 1;
    let nativeMuted = false;
    let sequence = 0;
    let emit: ((event: NativePlaybackEvent) => void) | undefined;
    const playback = playbackPort({
      setVolume: async (sessionId, value) => {
        if (sessionId === "watch:2" && !resolveRestoredVolume) {
          await new Promise<void>((resolve) => { resolveRestoredVolume = resolve; });
        }
        nativeVolume = value;
        return { kind: "applied", session: { pictureInPictureEligible: false, sessionId } };
      },
      setMuted: async (sessionId, value) => {
        if (sessionId === "watch:2") nativeMuted = value;
        return { kind: "applied", session: { pictureInPictureEligible: false, sessionId } };
      },
      subscribe: (listener) => { emit = listener; return () => undefined; },
    });
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => `watch:${++sequence}` },
      sources: sources(),
    });
    await session.start(target);
    await session.setVolume(0.3);
    await session.setMuted(true);
    const refreshing = session.refresh(target);
    await vi.waitFor(() => expect(resolveRestoredVolume).toBeDefined());
    expect(session.snapshot(target)).toMatchObject({
      kind: "active",
      session: { sessionId: "watch:2" },
    });
    emit?.({ kind: "playing", sessionId: "watch:2" });
    emit?.({
      durationMs: 60_000,
      kind: "progress",
      positionMs: 12_000,
      seekable: true,
      sessionId: "watch:2",
    });
    await session.setVolume(0.7);
    await session.setMuted(false);
    resolveRestoredVolume?.();
    await expect(refreshing).resolves.toMatchObject({ kind: "started" });
    expect(nativeVolume).toBe(0.7);
    expect(nativeMuted).toBe(false);
    expect(session.peek()).toMatchObject({
      muted: false,
      progress: { positionMs: 12_000 },
      state: { phase: "playing", session: { sessionId: "watch:2" } },
      volume: 0.7,
    });
  });

  it("retains a native failure while refreshed controls are restoring", async () => {
    let resolveRestoredVolume: (() => void) | undefined;
    let sequence = 0;
    let emit: ((event: NativePlaybackEvent) => void) | undefined;
    const locks: string[] = [];
    setWatchOrientationControllerForTests({
      lockAsync: async (lock) => { locks.push(lock); },
    });
    const playback = playbackPort({
      setVolume: async (sessionId) => {
        if (sessionId === "watch:2") {
          await new Promise<void>((resolve) => { resolveRestoredVolume = resolve; });
        }
        return { kind: "applied", session: { pictureInPictureEligible: false, sessionId } };
      },
      subscribe: (listener) => { emit = listener; return () => undefined; },
    });
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: protection(),
      sessionIds: { create: () => `watch:${++sequence}` },
      sources: sources(),
    });
    await session.start(target);
    session.enterFullscreen();
    const refreshing = session.refresh(target);
    await vi.waitFor(() => expect(resolveRestoredVolume).toBeDefined());
    emit?.({
      code: "PLAYBACK_NETWORK_FAILED",
      detail: "network dropped",
      kind: "failed",
      sessionId: "watch:2",
    });
    resolveRestoredVolume?.();
    await expect(refreshing).resolves.toMatchObject({
      failure: { code: "PLAYBACK_NETWORK_FAILED", detail: "network dropped" },
      kind: "failed",
    });
    expect(session.snapshot(target)).toMatchObject({
      failure: { code: "PLAYBACK_NETWORK_FAILED" },
      kind: "failed",
    });
    expect(session.peek().kind).toBe("idle");
    expect(locks).toEqual(["landscape", "portrait-up"]);
  });

  it("discards a refreshed native session when a newer Watch start wins", async () => {
    let resolveVolume: ((result: Awaited<ReturnType<FocusedPlaybackPort["setVolume"]>>) => void) | undefined;
    const released: string[] = [];
    const playback = playbackPort({
      setVolume: async (sessionId) => {
        if (sessionId === "watch:2") {
          return new Promise((resolve) => { resolveVolume = resolve; });
        }
        return { kind: "applied", session: { pictureInPictureEligible: false, sessionId } };
      },
    });
    let sequence = 0;
    const session = createFocusedWatchSession({
      playback,
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: {
        ...protection(),
        acquire: (sessionId) => ({ release: () => { released.push(sessionId); } }),
      },
      sessionIds: { create: () => `watch:${++sequence}` },
      sources: sources(),
    });
    await session.start(target);
    const refreshing = session.refresh(target);
    await vi.waitFor(() => expect(resolveVolume).toBeDefined());
    const other: WatchTarget = {
      channelId: "twitch-2",
      channelName: "other",
      platform: "twitch",
    };
    await session.start(other);
    resolveVolume?.({
      kind: "applied",
      session: { pictureInPictureEligible: false, sessionId: "watch:2" },
    });
    await expect(refreshing).resolves.toEqual({ kind: "cancelled" });
    expect(session.snapshot(other)).toMatchObject({
      kind: "active",
      session: { sessionId: "watch:3" },
    });
    expect(playback.ended).toEqual(["watch:1", "watch:2"]);
    expect(released).toEqual(["watch:1", "watch:2"]);
  });
});
