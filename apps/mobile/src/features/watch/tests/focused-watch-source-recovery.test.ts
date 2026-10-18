import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  FocusedPlaybackPort,
  FocusedPlaybackProtectionPort,
  LivePlaybackSources,
  NativePlaybackEvent,
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

function fixture(resolve: LivePlaybackSources["twitch"]["resolve"] = async () => ({
  integration: "twitch-gql-usher",
  kind: "resolved",
  requestHeaders: {},
  sourceUri: second,
})) {
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
      return { kind: "started", session: { pictureInPictureEligible: true, sessionId: request.sessionId } };
    },
    async recoverSource(request) {
      recoveries.push(request);
      return { kind: "applied", session: { pictureInPictureEligible: true, sessionId: request.sessionId } };
    },
    async end(sessionId) { ended.push(sessionId); return { kind: "ended", sessionId }; },
    async enterPictureInPicture(sessionId) { return { kind: "entered", session: { pictureInPictureEligible: true, sessionId } }; },
    async listQualities(sessionId) { return { kind: "listed", catalog: { qualities: ["auto"], selected: "auto", sessionId } }; },
    async setMuted(sessionId) { return { kind: "applied", session: { pictureInPictureEligible: true, sessionId } }; },
    async setPlaying(sessionId) { return { kind: "applied", session: { pictureInPictureEligible: true, sessionId } }; },
    async seekTo(sessionId) { return { kind: "applied", session: { pictureInPictureEligible: true, sessionId } }; },
    async setQuality(sessionId, selected) { return { kind: "listed", catalog: { qualities: ["auto"], selected, sessionId } }; },
    async setVolume(sessionId) { return { kind: "applied", session: { pictureInPictureEligible: true, sessionId } }; },
    subscribe(listener) { emit = listener; return () => { emit = undefined; }; },
  };
  const protection: FocusedPlaybackProtectionPort = {
    acquire(sessionId) { return { release() { released.push(sessionId); } }; },
    snapshot: () => ({ kind: "normal" }),
    subscribe: () => () => undefined,
  };
  const sources: LivePlaybackSources = {
    twitch: {
      integration: "twitch-gql-usher",
      platform: "twitch",
      async resolve(input) {
        resolutions += 1;
        if (resolutions === 1) return {
          integration: "twitch-gql-usher", kind: "resolved", requestHeaders: {}, sourceUri: first,
        };
        return resolve(input);
      },
    },
    kick: {
      integration: "kick-v1-playback-url", platform: "kick",
      async resolve() { return { integration: "kick-v1-playback-url", kind: "unavailable", failure: { kind: "channel-offline", detail: "Unused" } }; },
    },
  };
  const session = createFocusedWatchSession({
    playback,
    policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
    protection,
    sessionIds: { create: () => "watch:1" },
    sources,
  });
  return { session, emit: (event: NativePlaybackEvent) => emit?.(event), starts, recoveries, ended, released, get resolutions() { return resolutions; } };
}

afterEach(() => vi.useRealTimers());

describe("focused live source recovery", () => {
  it("resolves a fresh source after a native interruption while retaining the session and presentation", async () => {
    vi.useFakeTimers();
    const app = fixture();
    await app.session.start(target);
    app.session.enterFullscreen();
    await app.session.setMuted(true);
    await app.session.setVolume(0.3);
    await app.session.setQuality("720p");
    app.emit({ kind: "source-recovery-required", sessionId: "watch:1", interruptionId: 1 });
    expect(app.session.peek()).toMatchObject({ kind: "active", muted: true, volume: 0.3, quality: "720p", presentation: { presentation: "fullscreen" }, state: { phase: "buffering", session: { sessionId: "watch:1" } } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.starts).toHaveLength(1);
    expect(app.starts[0]).toMatchObject({ sourceRecovery: "resolve-live-source" });
    expect(app.recoveries).toEqual([{ sessionId: "watch:1", interruptionId: 1, sourceUri: second, requestHeaders: {} }]);
    expect(app.ended).toEqual([]);
    expect(app.released).toEqual([]);
  });

  it("backs off after a transient resolver failure and stops after a confirmed offline result", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const app = fixture(async () => ++reads === 1
      ? { kind: "unavailable", integration: "twitch-gql-usher", failure: { kind: "provider-rejected", status: 503, detail: "Unavailable" } }
      : { kind: "unavailable", integration: "twitch-gql-usher", failure: { kind: "channel-offline", detail: "Offline" } });
    await app.session.start(target);
    app.emit({ kind: "source-recovery-required", sessionId: "watch:1", interruptionId: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.session.snapshot(target)).toMatchObject({ kind: "active", phase: "buffering" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(app.session.snapshot(target)).toMatchObject({ kind: "failed", failure: { code: "channel-offline" } });
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
      if (recoveryReads === 1) await new Promise<void>((resolve) => { finish = resolve; });
      return { integration: "twitch-gql-usher", kind: "resolved", requestHeaders: {}, sourceUri: second };
    });
    await app.session.start(target);
    app.emit({ kind: "source-recovery-required", sessionId: "watch:1", interruptionId: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    await app.session.setPlaying(false);
    expect(signal?.aborted).toBe(true);
    finish?.();
    await Promise.resolve();
    expect(app.recoveries).toEqual([]);
    await app.session.setPlaying(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(app.recoveries).toEqual([{ sessionId: "watch:1", interruptionId: 1, sourceUri: second, requestHeaders: {} }]);
  });
});
