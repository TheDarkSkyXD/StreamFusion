import { describe, expect, it, vi } from "vitest";

import type {
  AndroidPlaybackContractPort,
  PlaybackSessionRequest,
  PlaybackSourceRecoveryRequest,
} from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import { createAndroidFocusedPlaybackPort } from "../adapters/android/android-focused-playback";
import { asHlsSourceUri } from "../domain/hls-source";

describe("Android focused playback", () => {
  it("maps source protection on start and recovery without exposing license data", async () => {
    const state = { sessionId: "watch:1", pictureInPictureEligible: true };
    const completed = { kind: "completed" as const, value: state };
    const startFocusedSession = vi.fn(
      async (_request: PlaybackSessionRequest) => completed,
    );
    const recoverSource = vi.fn(
      async (_request: PlaybackSourceRecoveryRequest) => completed,
    );
    const contract: AndroidPlaybackContractPort = {
      readiness: () => ({
        capability: "playback",
        contractVersion: 7,
        kind: "ready",
      }),
      startFocusedSession,
      recoverSource,
      endFocusedSession: vi.fn(),
      enterPictureInPicture: vi.fn(),
      listQualities: vi.fn(),
      setMuted: vi.fn(),
      setPlaying: vi.fn(),
      seekTo: vi.fn(),
      setQuality: vi.fn(),
      setVolume: vi.fn(),
      subscribe: () => () => undefined,
    };
    const playback = createAndroidFocusedPlaybackPort(contract);
    const source = {
      sessionId: "watch:1",
      sourceUri: asHlsSourceUri(
        "https://usher.ttvnw.net/api/channel/hls/ninja.m3u8?cdm=wv",
      )!,
      requestHeaders: {},
      protection: {
        kind: "widevine" as const,
        authorization: {
          kind: "provider-live" as const,
          platform: "twitch" as const,
          channelName: "ninja",
        },
      },
    };
    await playback.start(source);
    await playback.recoverSource?.({ ...source, interruptionId: 1 });
    const nativeProtection = { kind: "twitch-widevine", channelName: "ninja" };
    expect(startFocusedSession).toHaveBeenCalledWith(
      expect.objectContaining({ protection: nativeProtection }),
    );
    expect(recoverSource).toHaveBeenCalledWith(
      expect.objectContaining({ protection: nativeProtection }),
    );
    expect(startFocusedSession.mock.calls[0]?.[0]).toEqual({
      sessionId: "watch:1",
      sourceUri: source.sourceUri,
      requestHeaders: {},
      protection: nativeProtection,
    });
    await playback.start({
      sessionId: "watch:2",
      sourceUri: source.sourceUri,
      requestHeaders: {},
    });
    expect(startFocusedSession.mock.calls[1]?.[0]).not.toHaveProperty(
      "protection",
    );
  });
});
