import { afterEach, describe, expect, it, vi } from "vitest";

import type { TwitchPlaylistProxyPreferences } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";
import type { PlaybackFiltering } from "@mobile/features/ad-blocking/capabilities/ad-blocking";

import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtectionPort,
  LivePlaybackSources,
  NativePlaybackEvent,
  PlaybackSourceProtection,
  WatchSessionIdSource,
  WatchTarget,
} from "../capabilities/watch";
import { createFocusedWatchSession } from "../domain/focused-watch-session";
import { asHlsSourceUri } from "../domain/hls-source";

const target: WatchTarget = {
  channelId: "twitch-1",
  channelName: "live",
  platform: "twitch",
};
const first = asHlsSourceUri("https://example.com/first.m3u8")!;
const second = asHlsSourceUri("https://example.com/second.m3u8")!;
const third = asHlsSourceUri("https://example.com/third.m3u8")!;
const widevine: PlaybackSourceProtection = {
  kind: "widevine",
  authorization: {
    kind: "provider-live",
    platform: "twitch",
    channelName: "live",
  },
};

function fixture(
  resolve: LivePlaybackSources["twitch"]["resolve"] = async () => ({
    integration: "twitch-gql-usher",
    kind: "resolved",
    requestHeaders: {},
    sourceUri: second,
  }),
  recover?: NonNullable<FocusedPlaybackPort["recoverSource"]>,
  sessionIds: WatchSessionIdSource = { create: () => "watch:1" },
  playlistProxy?: { snapshot(): Promise<TwitchPlaylistProxyPreferences> },
  initialProtection?: PlaybackSourceProtection,
  filtering?: PlaybackFiltering,
) {
  let emit: ((event: NativePlaybackEvent) => void) | undefined;
  const starts: Parameters<FocusedPlaybackPort["start"]>[0][] = [];
  const recoveries: {
    sessionId: string;
    interruptionId: number;
    sourceUri: string;
  }[] = [];
  const ended: string[] = [];
  const released: string[] = [];
  let resolutions = 0;
  const playback: FocusedPlaybackPort = {
    async start(request) {
      starts.push(request);
      return {
        kind: "started",
        session: {
          pictureInPictureEligible: true,
          sessionId: request.sessionId,
        },
      };
    },
    async recoverSource(request) {
      recoveries.push(request);
      if (recover) return recover(request);
      return {
        kind: "applied",
        session: {
          pictureInPictureEligible: true,
          sessionId: request.sessionId,
        },
      };
    },
    async end(sessionId) {
      ended.push(sessionId);
      return { kind: "ended", sessionId };
    },
    async enterPictureInPicture(sessionId) {
      return {
        kind: "entered",
        session: { pictureInPictureEligible: true, sessionId },
      };
    },
    async listQualities(sessionId) {
      return {
        kind: "listed",
        catalog: { qualities: ["auto"], selected: "auto", sessionId },
      };
    },
    async setMuted(sessionId) {
      return {
        kind: "applied",
        session: { pictureInPictureEligible: true, sessionId },
      };
    },
    async setPlaying(sessionId) {
      return {
        kind: "applied",
        session: { pictureInPictureEligible: true, sessionId },
      };
    },
    async seekTo(sessionId) {
      return {
        kind: "applied",
        session: { pictureInPictureEligible: true, sessionId },
      };
    },
    async setQuality(sessionId, selected) {
      return {
        kind: "listed",
        catalog: { qualities: ["auto"], selected, sessionId },
      };
    },
    async setVolume(sessionId) {
      return {
        kind: "applied",
        session: { pictureInPictureEligible: true, sessionId },
      };
    },
    subscribe(listener) {
      emit = listener;
      return () => {
        emit = undefined;
      };
    },
  };
  const protection: FocusedPlaybackProtectionPort = {
    acquire(sessionId) {
      return {
        release() {
          released.push(sessionId);
        },
      };
    },
    snapshot: () => ({ kind: "normal" }),
    subscribe: () => () => undefined,
  };
  const sources: LivePlaybackSources = {
    twitch: {
      integration: "twitch-gql-usher",
      platform: "twitch",
      async resolve(input) {
        resolutions += 1;
        if (resolutions === 1)
          return {
            integration: "twitch-gql-usher",
            kind: "resolved",
            requestHeaders: {},
            sourceUri: first,
            ...(initialProtection ? { protection: initialProtection } : {}),
          };
        return resolve(input);
      },
    },
    kick: {
      integration: "kick-v1-playback-url",
      platform: "kick",
      async resolve() {
        return {
          integration: "kick-v1-playback-url",
          kind: "unavailable",
          failure: { kind: "channel-offline", detail: "Unused" },
        };
      },
    },
  };
  const session = createFocusedWatchSession({
    playback,
    policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
    protection,
    sessionIds,
    sources,
    ...(filtering ? { filtering } : {}),
    ...(playlistProxy ? { playlistProxy } : {}),
  });
  return {
    session,
    emit: (event: NativePlaybackEvent) => emit?.(event),
    starts,
    recoveries,
    ended,
    released,
    get resolutions() {
      return resolutions;
    },
  };
}

async function heartbeat(app: ReturnType<typeof fixture>, elapsedMs: number) {
  vi.setSystemTime(Date.now() + elapsedMs);
  const peek = app.session.peek();
  if (peek.kind !== "active")
    throw new Error("Expected an active Watch session");
  app.emit({
    kind: "progress",
    sessionId: peek.state.session.sessionId,
    durationMs: 0,
    positionMs: 0,
    seekable: false,
  });
  for (let step = 0; step < 8; step += 1) await Promise.resolve();
}

afterEach(() => vi.useRealTimers());

describe("focused live source recovery", () => {
  it("keeps protection on direct start and recovery while proxy preferences are enabled", async () => {
    vi.useFakeTimers();
    const app = fixture(
      async () => ({
        integration: "twitch-gql-usher",
        kind: "resolved",
        requestHeaders: {},
        sourceUri: second,
        protection: widevine,
      }),
      undefined,
      undefined,
      {
        snapshot: async () => ({
          enabled: true,
          sources: [
            {
              id: "proxy",
              enabled: true,
              addQueryParams: false,
              url: "https://proxy.example/live/$channel",
            },
          ],
        }),
      },
      widevine,
      {
        effective: async () => ({
          enabled: true,
          mode: "strip",
          platform: "twitch",
        }),
      },
    );
    await app.session.start(target);
    expect(app.starts).toMatchObject([
      {
        sourceUri: first,
        protection: widevine,
        filtering: { enabled: true, mode: "strip", channelName: "live" },
      },
    ]);
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    await heartbeat(app, 1000);
    expect(app.recoveries).toMatchObject([
      {
        sourceUri: second,
        protection: widevine,
        filtering: { enabled: true, mode: "strip", channelName: "live" },
      },
    ]);
  });

  it("retries from native progress while JavaScript timers are suspended in PiP", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const app = fixture();
    await app.session.start(target);
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    vi.setSystemTime(999);
    app.emit({
      kind: "progress",
      sessionId: "watch:1",
      durationMs: 0,
      positionMs: 0,
      seekable: false,
    });
    expect(app.recoveries).toEqual([]);
    vi.setSystemTime(1_000);
    app.emit({
      kind: "progress",
      sessionId: "watch:1",
      durationMs: 0,
      positionMs: 0,
      seekable: false,
    });
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
    expect(app.recoveries).toMatchObject([
      { sessionId: "watch:1", interruptionId: 1, sourceUri: second },
    ]);
    expect(app.ended).toEqual([]);
  });

  it("resolves a fresh source after a native interruption while retaining the session and presentation", async () => {
    vi.useFakeTimers();
    const app = fixture();
    await app.session.start(target);
    app.session.enterFullscreen();
    await app.session.setMuted(true);
    await app.session.setVolume(0.3);
    await app.session.setQuality("720p");
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    expect(app.session.peek()).toMatchObject({
      kind: "active",
      muted: true,
      volume: 0.3,
      quality: "720p",
      presentation: { presentation: "fullscreen" },
      state: { phase: "buffering", session: { sessionId: "watch:1" } },
    });
    await heartbeat(app, 1000);
    expect(app.starts).toHaveLength(1);
    expect(app.starts[0]).toMatchObject({
      sourceRecovery: "resolve-live-source",
    });
    expect(app.recoveries).toEqual([
      {
        sessionId: "watch:1",
        interruptionId: 1,
        sourceUri: second,
        requestHeaders: {},
      },
    ]);
    expect(app.ended).toEqual([]);
    expect(app.released).toEqual([]);
  });

  it("backs off after a transient resolver failure and stops after a confirmed offline result", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const app = fixture(async () =>
      ++reads === 1
        ? {
            kind: "unavailable",
            integration: "twitch-gql-usher",
            failure: {
              kind: "provider-rejected",
              status: 503,
              detail: "Unavailable",
            },
          }
        : {
            kind: "unavailable",
            integration: "twitch-gql-usher",
            failure: { kind: "channel-offline", detail: "Offline" },
          },
    );
    await app.session.start(target);
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    await heartbeat(app, 1000);
    expect(app.session.snapshot(target)).toMatchObject({
      kind: "active",
      phase: "buffering",
    });
    await heartbeat(app, 2000);
    expect(app.session.snapshot(target)).toMatchObject({
      kind: "failed",
      failure: { code: "channel-offline" },
    });
    expect(app.ended).toEqual(["watch:1"]);
    expect(app.released).toEqual(["watch:1"]);
  });

  it("aborts a pending resolution on pause and resumes the same interruption", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    let recoveryReads = 0;
    const app = fixture(async (input) => {
      recoveryReads += 1;
      signal = input.signal;
      if (recoveryReads === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return {
        integration: "twitch-gql-usher",
        kind: "resolved",
        requestHeaders: {},
        sourceUri: second,
      };
    });
    await app.session.start(target);
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    await heartbeat(app, 1000);
    await app.session.setPlaying(false);
    expect(signal?.aborted).toBe(true);
    finish?.();
    await Promise.resolve();
    expect(app.recoveries).toEqual([]);
    await app.session.setPlaying(true);
    await heartbeat(app, 1000);
    expect(app.recoveries).toEqual([
      {
        sessionId: "watch:1",
        interruptionId: 1,
        sourceUri: second,
        requestHeaders: {},
      },
    ]);
  });

  it("discards a late source when Watch is dismissed", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const app = fixture(async (input) => {
      signal = input.signal;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return {
        integration: "twitch-gql-usher",
        kind: "resolved",
        requestHeaders: {},
        sourceUri: second,
      };
    });
    await app.session.start(target);
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    await heartbeat(app, 1000);
    await app.session.dismiss();
    expect(signal?.aborted).toBe(true);
    finish?.();
    await Promise.resolve();
    expect(app.session.snapshot(target)).toMatchObject({ kind: "ready" });
    expect(app.recoveries).toEqual([]);
    expect(app.ended).toEqual(["watch:1"]);
    expect(app.released).toEqual(["watch:1"]);
  });

  it("waits for native readiness before resetting backoff", async () => {
    vi.useFakeTimers();
    const app = fixture();
    await app.session.start(target);
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    await heartbeat(app, 1000);
    app.emit({ kind: "playing", sessionId: "watch:1" });
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 2,
    });
    await heartbeat(app, 1000);
    expect(app.recoveries).toHaveLength(1);
    await heartbeat(app, 1000);
    expect(app.recoveries).toHaveLength(2);
    app.emit({
      kind: "source-recovered",
      sessionId: "watch:1",
      interruptionId: 2,
    });
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 3,
    });
    await heartbeat(app, 1000);
    expect(app.recoveries).toHaveLength(3);
  });

  it("shows a paused control when native pauses during recovery and resumes the pending source", async () => {
    vi.useFakeTimers();
    const app = fixture();
    await app.session.start(target);
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    app.emit({ kind: "paused", sessionId: "watch:1" });
    expect(app.session.snapshot(target)).toMatchObject({
      kind: "active",
      phase: "paused",
    });
    await heartbeat(app, 5000);
    expect(app.recoveries).toEqual([]);
    await app.session.setPlaying(true);
    expect(app.session.snapshot(target)).toMatchObject({
      kind: "active",
      phase: "buffering",
    });
    await heartbeat(app, 1000);
    expect(app.recoveries).toHaveLength(1);
  });

  it("reschedules when an in-flight native recovery call rejects after pause", async () => {
    vi.useFakeTimers();
    let rejectFirst: ((error: Error) => void) | undefined;
    let calls = 0;
    const app = fixture(undefined, async (request) => {
      if (++calls === 1)
        return new Promise((_, reject) => {
          rejectFirst = reject;
        });
      return {
        kind: "applied",
        session: {
          pictureInPictureEligible: true,
          sessionId: request.sessionId,
        },
      };
    });
    await app.session.start(target);
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    await heartbeat(app, 1000);
    expect(app.recoveries).toHaveLength(1);
    await app.session.setPlaying(false);
    expect(app.session.snapshot(target)).toMatchObject({
      kind: "active",
      phase: "paused",
    });
    rejectFirst?.(new Error("Bridge call rejected"));
    await Promise.resolve();
    await Promise.resolve();
    await app.session.setPlaying(true);
    await heartbeat(app, 1000);
    expect(app.recoveries).toHaveLength(2);
  });

  it("ignores a late pause from the previous session before recovering the current one", async () => {
    vi.useFakeTimers();
    let sequence = 0;
    const app = fixture(undefined, undefined, {
      create: () => `watch:${++sequence}`,
    });
    await app.session.start(target);
    await app.session.start({
      ...target,
      channelId: "twitch-2",
      channelName: "other",
    });
    app.emit({ kind: "paused", sessionId: "watch:1" });
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:2",
      interruptionId: 1,
    });
    await heartbeat(app, 1000);
    expect(app.recoveries).toMatchObject([
      { sessionId: "watch:2", interruptionId: 1, sourceUri: second },
    ]);
    expect(app.session.peek()).toMatchObject({
      kind: "active",
      state: { phase: "buffering", session: { sessionId: "watch:2" } },
    });
  });

  it("advances through configured Twitch proxies to a freshly resolved direct source", async () => {
    vi.useFakeTimers();
    let resolves = 0;
    const app = fixture(
      async () =>
        ++resolves === 1
          ? {
              integration: "twitch-gql-usher",
              kind: "unavailable",
              failure: {
                kind: "provider-rejected",
                status: 503,
                detail: "Unavailable",
              },
            }
          : {
              integration: "twitch-gql-usher",
              kind: "resolved",
              requestHeaders: {},
              sourceUri: resolves === 2 ? second : third,
            },
      undefined,
      undefined,
      {
        snapshot: async () => ({
          enabled: true,
          sources: [
            {
              id: "a",
              url: "https://proxy-a.example/live/$channel",
              enabled: true,
              addQueryParams: false,
            },
            {
              id: "b",
              url: "https://proxy-b.example/live/$channel",
              enabled: true,
              addQueryParams: false,
            },
          ],
        }),
      },
    );
    await app.session.start(target);
    expect(app.starts[0]?.sourceUri).toBe("https://proxy-a.example/live/live");
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 1,
    });
    await heartbeat(app, 1000);
    expect(app.recoveries).toEqual([]);
    await heartbeat(app, 2000);
    expect(app.recoveries[0]?.sourceUri).toBe(
      "https://proxy-b.example/live/live",
    );
    app.emit({
      kind: "source-recovery-required",
      sessionId: "watch:1",
      interruptionId: 2,
    });
    await app.session.setPlaying(false);
    await heartbeat(app, 10_000);
    expect(app.recoveries).toHaveLength(1);
    await app.session.setPlaying(true);
    await heartbeat(app, 5000);
    expect(app.recoveries[1]?.sourceUri).toBe(third);
    expect(app.resolutions).toBe(4);
  });
});
