// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import type {
  FocusedPlaybackPort,
  LivePlaybackSources,
} from "@mobile/features/watch/capabilities/watch";
import { createFocusedWatchSession } from "@mobile/features/watch/domain/focused-watch-session";
import { asHlsSourceUri } from "@mobile/features/watch/domain/hls-source";
import { twitchHlsRequestHeaders } from "@mobile/features/watch/domain/hls-request-headers";
import { useShellWatchPresentation } from "../components/use-shell-watch-presentation";

const target = {
  channelId: "channel-1",
  channelName: "streamer",
  platform: "twitch" as const,
};

function playback(): FocusedPlaybackPort {
  return {
    async start({ sessionId }) {
      return {
        kind: "started",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    async end(sessionId) {
      return { kind: "missing", sessionId };
    },
    async enterPictureInPicture() {
      return {
        kind: "unsupported",
        failure: { code: "OPERATION_UNSUPPORTED", detail: "Unavailable." },
      };
    },
    async listQualities(sessionId) {
      return {
        kind: "listed",
        catalog: { qualities: ["auto"], selected: "auto", sessionId },
      };
    },
    async seekTo(sessionId) {
      return {
        kind: "applied",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    async setMuted(sessionId) {
      return {
        kind: "applied",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    async setPlaying(sessionId) {
      return {
        kind: "applied",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    async setQuality(sessionId) {
      return {
        kind: "listed",
        catalog: { qualities: ["auto"], selected: "auto", sessionId },
      };
    },
    async setVolume(sessionId) {
      return {
        kind: "applied",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    subscribe: () => () => undefined,
  };
}

const sources: LivePlaybackSources = {
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
      sourceUri: asHlsSourceUri(
        "https://usher.ttvnw.net/api/channel/hls/live.m3u8",
      )!,
    }),
  },
};

describe("shell Watch presentation", () => {
  it("shows playback started after the More screen mounts in the mini player", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let nextSession = 0;
    const session = createFocusedWatchSession({
      playback: playback(),
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: {
        acquire: () => ({ release() {} }),
        snapshot: () => ({ kind: "normal" }),
        subscribe: () => () => undefined,
      },
      sessionIds: { create: () => `watch:${++nextSession}` },
      sources,
    });
    const host = document.createElement("div");
    const root = createRoot(host);
    function Probe({ watchingWatch }: { readonly watchingWatch: boolean }) {
      useShellWatchPresentation(session, watchingWatch);
      return null;
    }

    try {
      await act(async () =>
        root.render(createElement(Probe, { watchingWatch: false })),
      );
      await act(async () => {
        await session.start(target);
      });
      expect(session.peek()).toMatchObject({
        kind: "active",
        presentation: { presentation: "mini" },
      });

      await act(async () =>
        root.render(createElement(Probe, { watchingWatch: true })),
      );
      expect(session.peek()).toMatchObject({
        kind: "active",
        presentation: { presentation: "watch" },
      });

      await act(async () =>
        root.render(createElement(Probe, { watchingWatch: false })),
      );
      await act(async () => {
        await session.start({ ...target, channelId: "channel-2" });
      });
      expect(session.peek()).toMatchObject({
        kind: "active",
        state: { session: { sessionId: "watch:2" } },
        presentation: { presentation: "mini" },
      });
    } finally {
      await act(async () => root.unmount());
      await session.dispose();
      vi.unstubAllGlobals();
    }
  });
});
