import { describe, expect, it } from "vitest";

import type {
  FocusedPlaybackPort,
  LivePlaybackSources,
  PlaybackCompatibilityPolicy,
} from "@mobile/features/watch/capabilities/watch";
import { asHlsSourceUri } from "@mobile/features/watch/domain/hls-source";
import { twitchHlsRequestHeaders } from "@mobile/features/watch/domain/hls-request-headers";

import { emptyMultistreamLayout } from "../capabilities/multistream";
import { addMultistreamSlot, slotFromWatchTarget } from "../domain/multistream-layout";
import {
  createMultistreamPlayback,
  IDLE_MULTISTREAM_PLAYBACK_SNAPSHOT,
} from "../domain/multistream-playback";

// Guards: Multistream starts one session per active slot and mutes non-owners
// Guards: thermal stage keeps extra slots retained instead of dropping them

const sourceUri = asHlsSourceUri(
  "https://usher.ttvnw.net/api/channel/hls/live.m3u8",
)!;

function sources(): LivePlaybackSources {
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
      resolve: async () => ({
        integration: "twitch-gql-usher",
        kind: "resolved",
        requestHeaders: twitchHlsRequestHeaders(),
        sourceUri,
      }),
    },
  };
}

function playbackPort(): FocusedPlaybackPort & {
  muted: Record<string, boolean>;
  quality: Record<string, string>;
  started: string[];
} {
  const muted: Record<string, boolean> = {};
  const quality: Record<string, string> = {};
  const started: string[] = [];
  return {
    muted,
    quality,
    started,
    async start({ sessionId }) {
      started.push(sessionId);
      return {
        kind: "started",
        session: { pictureInPictureEligible: true, sessionId },
      };
    },
    async end() {
      return { kind: "missing", sessionId: "unused" };
    },
    enterPictureInPicture: async (sessionId) => ({
      kind: "entered",
      session: { pictureInPictureEligible: true, sessionId },
    }),
    listQualities: async (sessionId) => ({
      kind: "listed",
      catalog: { qualities: ["auto", "360p"], selected: "auto", sessionId },
    }),
    seekTo: async (sessionId) => ({
      kind: "applied",
      session: { pictureInPictureEligible: true, sessionId },
    }),
    setMuted: async (sessionId, next) => {
      muted[sessionId] = next;
      return {
        kind: "applied",
        session: { pictureInPictureEligible: true, sessionId },
      };
    },
    setPlaying: async (sessionId) => ({
      kind: "applied",
      session: { pictureInPictureEligible: true, sessionId },
    }),
    setQuality: async (sessionId, next) => {
      quality[sessionId] = next;
      return {
        kind: "listed",
        catalog: { qualities: ["auto", "360p"], selected: next, sessionId },
      };
    },
    setVolume: async (sessionId) => ({
      kind: "applied",
      session: { pictureInPictureEligible: true, sessionId },
    }),
    subscribe: () => () => undefined,
  };
}

const policy: PlaybackCompatibilityPolicy = {
  read: async () => ({ kind: "enabled", sequence: 1 }),
};

describe("multistream playback", () => {
  it("starts two active sessions and keeps one audio owner", async () => {
    const twitch = slotFromWatchTarget({
      channelId: "1",
      channelName: "one",
      platform: "twitch",
    });
    const second = slotFromWatchTarget({
      channelId: "2",
      channelName: "two",
      platform: "twitch",
    });
    const retained = slotFromWatchTarget({
      channelId: "3",
      channelName: "three",
      platform: "twitch",
    });
    let layout = emptyMultistreamLayout();
    for (const slot of [twitch, second, retained]) {
      const next = addMultistreamSlot(layout, slot, 1);
      if (next.kind === "applied") layout = next.layout;
    }
    const playback = playbackPort();
    const engine = createMultistreamPlayback({
      playback,
      policy,
      sources: sources(),
    });
    const qualified = await engine.sync({
      admission: { limit: 2, reason: "Measured two software decoders." },
      layout,
      stage: 0,
    });
    expect(qualified.activeSlotIds).toEqual([twitch.id, second.id]);
    expect(qualified.layout.audioOwnerId).toBe(twitch.id);
    expect(playback.started).toEqual([
      `multi:${twitch.id}`,
      `multi:${second.id}`,
    ]);
    expect(playback.muted[`multi:${twitch.id}`]).toBe(false);
    expect(playback.muted[`multi:${second.id}`]).toBe(true);
    const thermal = await engine.sync({
      admission: { limit: 2, reason: "Measured two software decoders." },
      layout,
      stage: 4,
    });
    expect(thermal.activeSlotIds).toEqual([twitch.id]);
    await engine.dispose();
  });
});

describe("multistream playback getSnapshot stability", () => {
  it("returns the same snapshot object until playback state changes", async () => {
    const engine = createMultistreamPlayback({
      playback: playbackPort(),
      policy,
      sources: sources(),
    });
    expect(engine.snapshot()).toBe(IDLE_MULTISTREAM_PLAYBACK_SNAPSHOT);
    expect(engine.snapshot()).toBe(engine.snapshot());
    const twitch = slotFromWatchTarget({
      channelId: "1",
      channelName: "one",
      platform: "twitch",
    });
    let layout = emptyMultistreamLayout();
    const added = addMultistreamSlot(layout, twitch, 1);
    if (added.kind === "applied") layout = added.layout;
    await engine.sync({
      admission: { limit: 1, reason: "one" },
      layout,
      stage: 0,
    });
    expect(engine.snapshot()).toBe(engine.snapshot());
    expect(engine.snapshot()).not.toBe(IDLE_MULTISTREAM_PLAYBACK_SNAPSHOT);
    await engine.dispose();
    expect(engine.snapshot()).toBe(IDLE_MULTISTREAM_PLAYBACK_SNAPSHOT);
  });
});
