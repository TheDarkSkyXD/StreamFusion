import { describe, expect, it, vi } from "vitest";
import type {
  FocusedPlaybackPort,
  HlsSourceUri,
} from "@mobile/features/watch/capabilities/watch";
import { createMultistreamSession } from "../domain/multistream-session";
import type {
  MultistreamResourceAdmission,
  MultistreamResourceMonitor,
} from "../capabilities/resource-admission";

function setup(
  limit = 2,
  resources: {
    admission?: MultistreamResourceAdmission;
    resourceMonitor?: MultistreamResourceMonitor;
  } = {},
) {
  const log: string[] = [];
  let sequence = 0;
  const playback: FocusedPlaybackPort = {
    start: async (input) => {
      log.push(`start:${input.sessionId}:${input.muted}`);
      return {
        kind: "started",
        session: { sessionId: input.sessionId, pictureInPictureEligible: true },
      };
    },
    end: async (id) => {
      log.push(`end:${id}`);
      return { kind: "ended", sessionId: id };
    },
    setMuted: async (id, muted) => {
      log.push(`mute:${id}:${muted}`);
      return {
        kind: "applied",
        session: { sessionId: id, pictureInPictureEligible: true },
      };
    },
    setPlaying: async (id, playing) => {
      log.push(`play:${id}:${playing}`);
      return {
        kind: "applied",
        session: { sessionId: id, pictureInPictureEligible: true },
      };
    },
    subscribe: () => () => {},
    enterPictureInPicture: vi.fn(),
    listQualities: vi.fn(),
    seekTo: vi.fn(),
    setQuality: vi.fn(),
    setVolume: vi.fn(),
  };
  const channels = {
    find: vi.fn(async (platform: "twitch" | "kick", login: string) => ({
      platform,
      channelName: login,
      channelId: login,
    })),
  };
  const resolve = vi.fn(async () => ({
    kind: "resolved" as const,
    integration: "twitch-gql-usher" as const,
    sourceUri: "https://example.com/live.m3u8" as HlsSourceUri,
    requestHeaders: {},
  }));
  const beforeStart = vi.fn(async () => {
    log.push("dismiss-watch");
  });
  const session = createMultistreamSession({
    playback,
    channels,
    resolve,
    beforeStart,
    sessionIds: { create: () => `player-${++sequence}` },
    policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
    limit: () => limit,
    ...resources,
  });
  return { session, playback, channels, resolve, log };
}
describe("Multistream session", () => {
  it("starts each player muted and switches one audio owner in order", async () => {
    const { session, log } = setup();
    await session.add("twitch", "alpha");
    await session.add("kick", "beta");
    await session.focus("player-1");
    await session.focus("player-2");
    expect(log).toEqual([
      "dismiss-watch",
      "start:player-1:true",
      "start:player-2:true",
      "mute:player-1:true",
      "mute:player-2:true",
      "mute:player-1:false",
      "mute:player-1:true",
      "mute:player-2:true",
      "mute:player-2:false",
    ]);
    expect(session.snapshot().audioOwner).toBe("player-2");
    await session.close();
    expect(session.snapshot().tiles).toEqual([]);
    expect(log.slice(-4)).toEqual([
      "mute:player-1:true",
      "mute:player-2:true",
      "end:player-1",
      "end:player-2",
    ]);
  });
  it("rejects duplicate channels and enforces capacity even for concurrent adds", async () => {
    const { session, resolve } = setup(1);
    await Promise.all([
      session.add("twitch", "alpha"),
      session.add("kick", "beta"),
    ]);
    expect(session.snapshot().tiles).toHaveLength(1);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(session.snapshot().status).toBe(
      "This workspace is limited to 1 streams.",
    );
  });
  it("cancels late source resolutions when the workspace closes", async () => {
    const { session, resolve, log } = setup();
    let release!: (value: Awaited<ReturnType<typeof resolve>>) => void;
    resolve.mockImplementation(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    const pending = session.add("twitch", "alpha");
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    const closed = session.close();
    release({
      kind: "resolved",
      integration: "twitch-gql-usher",
      sourceUri: "https://example.com/live.m3u8" as HlsSourceUri,
      requestHeaders: {},
    });
    await Promise.all([pending, closed]);
    expect(log).toEqual([]);
    expect(session.snapshot().tiles).toEqual([]);
  });
  it("stops a player whose mute command failed before selecting another", async () => {
    const { session, playback, log } = setup();
    await session.add("twitch", "alpha");
    await session.add("kick", "beta");
    playback.setMuted = async (id, muted) =>
      id === "player-1"
        ? { kind: "missing", sessionId: id }
        : {
            kind: "applied",
            session: { sessionId: id, pictureInPictureEligible: true },
          };
    await session.focus("player-2");
    expect(log).toContain("end:player-1");
    expect(session.snapshot().tiles[0]?.state).toBe("failed");
    expect(session.snapshot().audioOwner).toBe("player-2");
  });
  it("retains an uncertain player and never enables competing audio", async () => {
    const { session, playback, log } = setup();
    await session.add("twitch", "alpha");
    await session.add("kick", "beta");
    await session.focus("player-1");
    const mute = playback.setMuted;
    playback.setMuted = async (id, muted) =>
      id === "player-1"
        ? {
            kind: "unavailable",
            failure: { code: "INVOCATION_FAILED", detail: "Bridge failed." },
          }
        : mute(id, muted);
    const end = playback.end;
    playback.end = async (id) =>
      id === "player-1"
        ? {
            kind: "unavailable",
            failure: { code: "INVOCATION_FAILED", detail: "Bridge failed." },
          }
        : end(id);
    await session.focus("player-2");
    expect(log).not.toContain("mute:player-2:false");
    expect(session.snapshot().audioOwner).toBe("player-1");
    expect(session.snapshot().status).toBe(
      "Audio switching paused because a player could not confirm mute or stop.",
    );
    await session.close();
    expect(session.snapshot().tiles.map((tile) => tile.id)).toEqual([
      "player-1",
    ]);
    expect(session.snapshot().status).toBe(
      "Some players could not confirm stop. Retry removing them or restart the Android client.",
    );
    playback.end = end;
    await session.remove("player-1");
    expect(session.snapshot().tiles).toEqual([]);
  });
  it("reports pressure during playback and reduces to the current audio owner", async () => {
    let pressured = false;
    const { session, log } = setup(3, {
      admission: {
        read: async () =>
          pressured
            ? { kind: "pressured", detail: "Android reports low memory." }
            : { kind: "clear" },
      },
    });
    await session.add("twitch", "alpha");
    await session.add("kick", "beta");
    await session.add("twitch", "gamma");
    await session.focus("player-2");
    pressured = true;
    await session.recheckResources();
    expect(session.snapshot().resourcePressure).toEqual({
      kind: "pressured",
      detail: "Android reports low memory.",
    });
    await session.reduceToOne();
    expect(session.snapshot().tiles.map((tile) => tile.id)).toEqual(["player-2"]);
    expect(session.snapshot().audioOwner).toBe("player-2");
    expect(log.slice(-2)).toEqual(["end:player-1", "end:player-3"]);
  });
  it("retains an uncertain stop during pressure reduction", async () => {
    const { session, playback } = setup(2);
    await session.add("twitch", "alpha");
    await session.add("kick", "beta");
    playback.end = async (id) => ({
      kind: "unavailable",
      failure: { code: "INVOCATION_FAILED", detail: `Stop uncertain for ${id}.` },
    });
    await session.reduceToOne();
    expect(session.snapshot().tiles.map((tile) => tile.id)).toEqual([
      "player-1",
      "player-2",
    ]);
    expect(session.snapshot().tiles[1]?.detail).toBe(
      "Stop could not be confirmed. Retry removing this player or restart the Android client.",
    );
    expect(session.snapshot().status).toBe(
      "Some players could not confirm stop. Retry removing them or restart the Android client.",
    );
  });
  it("ignores a resource sample resolved after close", async () => {
    let reads = 0;
    let finish!: (value: { kind: "pressured"; detail: string }) => void;
    const { session } = setup(2, {
      admission: {
        read: () => {
          reads += 1;
          return reads === 1
            ? Promise.resolve({ kind: "clear" })
            : new Promise((resolve) => {
                finish = resolve;
              });
        },
      },
    });
    await session.add("twitch", "alpha");
    const sampling = session.recheckResources();
    await vi.waitFor(() => expect(reads).toBe(2));
    const closing = session.close();
    finish({ kind: "pressured", detail: "Stale pressure." });
    await Promise.all([sampling, closing]);
    expect(session.snapshot().resourcePressure).toEqual({ kind: "clear" });
    expect(session.snapshot().tiles).toEqual([]);
  });
  it("holds one monitor lease while tiles exist and releases it on close", async () => {
    let subscriptions = 0;
    let releases = 0;
    const { session } = setup(2, {
      resourceMonitor: {
        subscribe: () => {
          subscriptions += 1;
          return () => {
            releases += 1;
          };
        },
        dispose: () => {},
      },
    });
    await session.add("twitch", "alpha");
    await session.add("kick", "beta");
    expect(subscriptions).toBe(1);
    await session.close();
    expect(releases).toBe(1);
  });
});
