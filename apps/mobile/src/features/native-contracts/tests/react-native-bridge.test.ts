import { afterEach, describe, expect, it } from "vitest";
import { NativeModules } from "react-native";

import { androidPlaybackBindingReader } from "../adapters/react-native-capability-bindings";

afterEach(() => {
  delete NativeModules.StreamFusionPlayback;
});

describe("React Native contracts", () => {
  it("rejects an absent or incomplete playback bridge", () => {
    expect(() => androidPlaybackBindingReader.read()).toThrow(
      "StreamFusionPlayback is unavailable",
    );
    NativeModules.StreamFusionPlayback = { getContractVersion: () => 6 };
    expect(() => androidPlaybackBindingReader.read()).toThrow(
      "StreamFusionPlayback is unavailable",
    );
  });

  it("keeps playback commands and subscriptions on the same native module", async () => {
    const subscriptions: string[] = [];
    let removals = 0;
    NativeModules.StreamFusionPlayback = {
      getContractVersion: () => 6,
      recoverSource: async (request: unknown) => request,
      startFocusedSession: async (request: unknown) => request,
      endFocusedSession: async () => ({}),
      readPlaybackObservation: async () => ({}),
      setPlaybackSpeed: async () => ({}),
      setPlaying: async () => ({}),
      setMuted: async () => ({}),
      setVolume: async () => ({}),
      listQualities: async () => ({}),
      setQuality: async () => ({}),
      seekTo: async () => ({}),
      enterPictureInPicture: async () => ({}),
      addListener: (event: string) => subscriptions.push(event),
      removeListeners: (count: number) => {
        removals += count;
      },
    };

    const playback = androidPlaybackBindingReader.read();
    expect(playback.getContractVersion()).toBe(6);
    const request = {
      sessionId: "session-1",
      sourceUri: "https://example.com/stream.m3u8",
      requestHeaders: {},
    };
    expect(await playback.startFocusedSession(request)).toEqual(request);
    const subscription = playback.addListener?.("onNativePlayback", () => {});
    expect(subscriptions).toEqual(["onNativePlayback"]);
    subscription?.remove();
    expect(removals).toBe(1);
  });
});
