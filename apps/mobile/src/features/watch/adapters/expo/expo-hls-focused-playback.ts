import { createVideoPlayer, type VideoPlayer, type VideoSource } from "expo-video";

import type {
  FocusedPlaybackFailure,
  FocusedPlaybackPort,
  HlsSourceUri,
} from "../../capabilities/watch";
import {
  deleteExpoHlsPlaybackEntry,
  emitExpoHlsPlaybackEvent,
  getExpoHlsPlaybackEntry,
  setExpoHlsPlaybackEntry,
  subscribeExpoHlsPlayback,
} from "./expo-hls-playback-registry";

/**
 * Expo Go and other hosts without StreamFusionPlayback still resolve Twitch/Kick
 * HLS in JS. Use expo-video (shipped in Expo Go) so Watch can play without the
 * Media3 native module. Development builds keep the Media3 path.
 */
export function createExpoHlsFocusedPlaybackPort(): FocusedPlaybackPort {
  return {
    async start(input) {
      try {
        const source = videoSource(input.sourceUri, input.requestHeaders);
        if (getExpoHlsPlaybackEntry(input.sessionId)) {
          deleteExpoHlsPlaybackEntry(input.sessionId);
        }
        const player = createVideoPlayer(source);
        bindPlayerEvents(input.sessionId, player);
        player.loop = false;
        player.muted = false;
        player.play();
        setExpoHlsPlaybackEntry({ player, sessionId: input.sessionId });
        emitExpoHlsPlaybackEvent({
          kind: "buffering",
          sessionId: input.sessionId,
        });
        return {
          kind: "started",
          session: {
            pictureInPictureEligible: false,
            sessionId: input.sessionId,
          },
        };
      } catch (error) {
        return { failure: failureFrom(error), kind: "unavailable" };
      }
    },
    async end(sessionId) {
      if (!getExpoHlsPlaybackEntry(sessionId)) {
        return { kind: "missing", sessionId };
      }
      deleteExpoHlsPlaybackEntry(sessionId);
      emitExpoHlsPlaybackEvent({ kind: "ended", sessionId });
      return { kind: "ended", sessionId };
    },
    async enterPictureInPicture(_sessionId) {
      return {
        failure: {
          code: "OPERATION_UNSUPPORTED",
          detail: "Picture-in-picture is unavailable in the Expo Go player.",
        },
        kind: "unsupported",
      };
    },
    async listQualities(sessionId) {
      if (!getExpoHlsPlaybackEntry(sessionId)) {
        return {
          failure: {
            code: "INVOCATION_FAILED",
            detail: "No Expo Go playback session is active.",
          },
          kind: "unavailable",
        };
      }
      return {
        catalog: {
          qualities: ["auto"],
          selected: "auto",
          sessionId,
        },
        kind: "listed",
      };
    },
    async setMuted(sessionId, muted) {
      const entry = getExpoHlsPlaybackEntry(sessionId);
      if (!entry) return { kind: "missing", sessionId };
      entry.player.muted = muted;
      return {
        kind: "applied",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    async setPlaying(sessionId, playing) {
      const entry = getExpoHlsPlaybackEntry(sessionId);
      if (!entry) return { kind: "missing", sessionId };
      if (playing) entry.player.play();
      else entry.player.pause();
      emitExpoHlsPlaybackEvent(
        playing
          ? { kind: "playing", sessionId }
          : { kind: "paused", reason: "user", sessionId },
      );
      return {
        kind: "applied",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    async setQuality(sessionId, _quality) {
      if (!getExpoHlsPlaybackEntry(sessionId)) {
        return {
          failure: {
            code: "INVOCATION_FAILED",
            detail: "No Expo Go playback session is active.",
          },
          kind: "unavailable",
        };
      }
      return {
        catalog: {
          qualities: ["auto"],
          selected: "auto",
          sessionId,
        },
        kind: "listed",
      };
    },
    async seekTo(sessionId, positionMs) {
      const entry = getExpoHlsPlaybackEntry(sessionId);
      if (!entry) return { kind: "missing", sessionId };
      entry.player.currentTime = Math.max(0, positionMs / 1000);
      return {
        kind: "applied",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    async setVolume(sessionId, volume) {
      const entry = getExpoHlsPlaybackEntry(sessionId);
      if (!entry) return { kind: "missing", sessionId };
      entry.player.volume = clamp01(volume);
      return {
        kind: "applied",
        session: { pictureInPictureEligible: false, sessionId },
      };
    },
    subscribe(listener) {
      return subscribeExpoHlsPlayback(listener);
    },
  };
}

function videoSource(
  sourceUri: HlsSourceUri,
  requestHeaders: Readonly<Record<string, string>>,
): VideoSource {
  return {
    contentType: "hls",
    headers: { ...requestHeaders },
    uri: sourceUri,
  };
}

function bindPlayerEvents(sessionId: string, player: VideoPlayer): void {
  player.addListener("statusChange", ({ status, error }) => {
    if (status === "loading") {
      emitExpoHlsPlaybackEvent({ kind: "buffering", sessionId });
      return;
    }
    if (status === "readyToPlay") {
      emitExpoHlsPlaybackEvent({ kind: "playing", sessionId });
      return;
    }
    if (status === "error") {
      emitExpoHlsPlaybackEvent({
        code: "PLAYBACK_UNKNOWN",
        detail: error?.message ?? "Expo Go player failed.",
        kind: "failed",
        sessionId,
      });
    }
  });
  player.addListener("playingChange", ({ isPlaying }) => {
    emitExpoHlsPlaybackEvent(
      isPlaying
        ? { kind: "playing", sessionId }
        : { kind: "paused", reason: "user", sessionId },
    );
  });
  player.addListener("playToEnd", () => {
    emitExpoHlsPlaybackEvent({ kind: "ended", sessionId });
  });
}

function failureFrom(error: unknown): FocusedPlaybackFailure {
  const detail =
    error instanceof Error && error.message.length > 0
      ? error.message
      : "Expo Go player could not start.";
  return { code: "INVOCATION_FAILED", detail };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}