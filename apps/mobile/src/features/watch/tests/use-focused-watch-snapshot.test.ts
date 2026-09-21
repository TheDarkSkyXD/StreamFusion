/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import { createMultistreamPlayback } from "@mobile/features/multistream/domain/multistream-playback";
import { createFocusedWatchSession } from "../domain/focused-watch-session";
import {
  useFocusedWatchSession,
  useWatchPeek,
} from "../components/use-focused-watch-session";
import type {
  FocusedPlaybackPort,
  LivePlaybackSources,
} from "../capabilities/watch";

function playbackPort(): FocusedPlaybackPort {
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
    enterPictureInPicture: async () => ({
      kind: "unsupported",
      failure: {
        code: "OPERATION_UNSUPPORTED",
        detail: "PiP is stubbed in this test.",
      },
    }),
    listQualities: async (sessionId) => ({
      kind: "listed",
      catalog: { qualities: ["auto"], selected: "auto", sessionId },
    }),
    seekTo: async (sessionId) => ({
      kind: "applied",
      session: { pictureInPictureEligible: false, sessionId },
    }),
    setMuted: async (sessionId) => ({
      kind: "applied",
      session: { pictureInPictureEligible: false, sessionId },
    }),
    setPlaying: async (sessionId) => ({
      kind: "applied",
      session: { pictureInPictureEligible: false, sessionId },
    }),
    setQuality: async (sessionId) => ({
      kind: "listed",
      catalog: { qualities: ["auto"], selected: "auto", sessionId },
    }),
    setVolume: async (sessionId) => ({
      kind: "applied",
      session: { pictureInPictureEligible: false, sessionId },
    }),
    subscribe: () => () => undefined,
  };
}

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
        failure: { detail: "unused", kind: "channel-offline" },
        integration: "twitch-gql-usher",
        kind: "unavailable",
      }),
    },
  };
}

describe("useFocusedWatchSession getSnapshot stability", () => {
  it("does not warn when peek and snapshot stay referentially stable", async () => {
    const session = createFocusedWatchSession({
      playback: playbackPort(),
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      protection: {
        acquire: () => ({ release() {} }),
        snapshot: () => ({ kind: "normal" }),
        subscribe: () => () => undefined,
      },
      sessionIds: { create: () => "watch:1" },
      sources: sources(),
    });
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
      orig(...args);
    };
    const host = document.createElement("div");
    const root = createRoot(host);
    function Probe({ n }: { readonly n: number }) {
      useWatchPeek(session);
      useFocusedWatchSession(session, {
        channelId: "1",
        channelName: "a",
        platform: "twitch",
      });
      return createElement("span", null, String(n));
    }
    await act(async () => {
      root.render(createElement(Probe, { n: 1 }));
    });
    await act(async () => {
      root.render(createElement(Probe, { n: 2 }));
    });
    console.error = orig;
    const msgs = errors.join("\n");
    expect(msgs).not.toMatch(/getSnapshot should be cached/);
    expect(msgs).not.toMatch(/Maximum update depth/);
    root.unmount();
  });
});

describe("MultistreamPlayback useSyncExternalStore stability", () => {
  it("does not warn when snapshot is cached across renders", async () => {
    const playback = createMultistreamPlayback({
      playback: playbackPort(),
      policy: { read: async () => ({ kind: "enabled", sequence: 1 }) },
      sources: sources(),
    });
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
      orig(...args);
    };
    const host = document.createElement("div");
    const root = createRoot(host);
    function Probe({ n }: { readonly n: number }) {
      useSyncExternalStore(
        playback.subscribe,
        playback.snapshot,
        playback.snapshot,
      );
      return createElement("span", null, String(n));
    }
    await act(async () => {
      root.render(createElement(Probe, { n: 1 }));
    });
    await act(async () => {
      root.render(createElement(Probe, { n: 2 }));
    });
    console.error = orig;
    const msgs = errors.join("\n");
    expect(msgs).not.toMatch(/getSnapshot should be cached/);
    expect(msgs).not.toMatch(/Maximum update depth/);
    root.unmount();
    await playback.dispose();
  });
});
