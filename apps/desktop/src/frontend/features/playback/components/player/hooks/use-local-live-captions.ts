import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_CAPTION_PREFERENCES } from "@shared/auth-types";
import {
  DEFAULT_LOCAL_CAPTION_MODEL_STATE,
  type LocalCaptionModelState,
  type LocalCaptionRecognizerPhase,
} from "@shared/local-caption-types";
import { useAuthStore } from "@/store/auth-store";

import { LocalAudioCaptureController } from "../local-audio-capture";
import { advanceLocalCaptionCue, applyLocalCaptionResult } from "../local-caption-presentation";
import type { TimedTextCue } from "../types";

type LocalCaptionPhase = "off" | "install-required" | LocalCaptionRecognizerPhase;
const LOCAL_CAPTION_MODEL_ID = "zipformer-en-20m-2023-02-17";
let runtimeGeneration = 0;

function allocateRuntimeGeneration(): number {
  runtimeGeneration += 1;
  return runtimeGeneration;
}

interface LocalNativeCaptionTrack {
  video: HTMLVideoElement;
  track: TextTrack;
}

function clearNativeCaptionTrack(state: LocalNativeCaptionTrack | null): void {
  if (!state) return;
  for (const cue of Array.from(state.track.cues ?? [])) state.track.removeCue(cue);
  state.track.mode = "disabled";
}

function createNativeCaptionCue(cue: TimedTextCue): TextTrackCue {
  if (typeof VTTCue === "function") return new VTTCue(cue.startTime, cue.endTime, cue.text);
  return cue as unknown as TextTrackCue;
}

function syncNativeCaptionTrack(
  video: HTMLVideoElement,
  stateRef: { current: LocalNativeCaptionTrack | null },
  cues: TimedTextCue[]
): void {
  if (stateRef.current?.video !== video) {
    clearNativeCaptionTrack(stateRef.current);
    stateRef.current = {
      video,
      track: video.addTextTrack("captions", "StreamFusion Local Captions"),
    };
  }
  const track = stateRef.current.track;
  for (const cue of Array.from(track.cues ?? [])) track.removeCue(cue);
  for (const cue of cues) track.addCue(createNativeCaptionCue(cue));
  track.mode = "showing";
}

interface UseLocalLiveCaptionsOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  sessionId: string;
  sourceKey: string;
  muted: boolean;
  volume: number;
  allowLocalCaptions?: boolean;
}

export function useLocalLiveCaptions({
  videoRef,
  sessionId,
  sourceKey,
  muted,
  volume,
  allowLocalCaptions = true,
}: UseLocalLiveCaptionsOptions) {
  const { t } = useTranslation();
  const translateRef = useRef(t);
  const captionPreferences = useAuthStore((state) => state.preferences?.captions ?? null);
  const updatePreferences = useAuthStore((state) => state.updatePreferences);
  const [modelState, setModelState] = useState<LocalCaptionModelState>(
    DEFAULT_LOCAL_CAPTION_MODEL_STATE
  );
  const [selected, setSelected] = useState(false);
  const [phase, setPhase] = useState<LocalCaptionPhase>("off");
  const [activeCues, setActiveCues] = useState<TimedTextCue[]>([]);
  const [clockEpoch, setClockEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef(false);
  const generationRef = useRef(0);
  const sequenceRef = useRef(0);
  const lastResultSequenceRef = useRef(0);
  const audioSendPendingRef = useRef(false);
  const controllerRef = useRef<LocalAudioCaptureController | null>(null);
  const nativeCaptionTrackRef = useRef<LocalNativeCaptionTrack | null>(null);
  const isPictureInPictureRef = useRef(false);
  const activeCuesRef = useRef(activeCues);
  const presentationRef = useRef({ muted, volume });
  const hasSource = sourceKey.length > 0;

  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  useLayoutEffect(() => {
    presentationRef.current = { muted, volume };
    activeCuesRef.current = activeCues;
  }, [activeCues, muted, volume]);

  const deactivate = useCallback(() => {
    selectedRef.current = false;
    setSelected(false);
    setPhase("off");
    setError(null);
    setActiveCues([]);
  }, []);

  useEffect(() => {
    if (!captionPreferences) return;
    if (!allowLocalCaptions) {
      deactivate();
      return;
    }
    const shouldRestoreLocal = captionPreferences.enabled && captionPreferences.source === "local";
    if (shouldRestoreLocal) {
      if (
        modelState.phase !== "ready" ||
        captionPreferences.localModelId !== LOCAL_CAPTION_MODEL_ID
      ) {
        setPhase("install-required");
      }
      if (selectedRef.current) return;
      generationRef.current = 0;
      sequenceRef.current = 0;
      lastResultSequenceRef.current = 0;
      selectedRef.current = true;
      setActiveCues([]);
      setError(null);
      setSelected(true);
      return;
    }

    deactivate();
  }, [allowLocalCaptions, captionPreferences, deactivate, modelState.phase]);

  useEffect(() => {
    const api = window.electronAPI?.localCaptions;
    if (!api) return;
    let disposed = false;
    void api.getModelState().then((state) => {
      if (!disposed && state && "phase" in state) setModelState(state);
    });
    const offModel = api.onModelState((state) => {
      if (!disposed) setModelState(state);
    });
    const offState = api.onRecognizerState((state) => {
      if (
        disposed ||
        !selectedRef.current ||
        state.sessionId !== sessionId ||
        state.generation !== generationRef.current
      ) {
        return;
      }
      setPhase(state.phase);
      setError(state.error ?? null);
      if (state.phase === "error" || state.phase === "stopped") {
        selectedRef.current = false;
        setSelected(false);
      }
    });
    const offResult = api.onResult((result) => {
      if (
        disposed ||
        !selectedRef.current ||
        result.sessionId !== sessionId ||
        result.generation !== generationRef.current ||
        result.sequence <= lastResultSequenceRef.current
      ) {
        return;
      }
      lastResultSequenceRef.current = result.sequence;
      setPhase("ready");
      setActiveCues((currentCues) => {
        const currentCue = currentCues[0] ?? null;
        const nextCue = applyLocalCaptionResult(currentCue, result);
        return nextCue === currentCue ? currentCues : [nextCue];
      });
    });
    return () => {
      disposed = true;
      offModel();
      offState();
      offResult();
    };
  }, [sessionId]);

  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- The returned cleanup removes every media listener and disposes the capture controller.
  useEffect(() => {
    if (!allowLocalCaptions || !selected) return;
    if (
      modelState.phase !== "ready" ||
      captionPreferences?.localModelId !== LOCAL_CAPTION_MODEL_ID ||
      !hasSource
    ) {
      return;
    }
    const api = window.electronAPI?.localCaptions;
    const video = videoRef.current;
    if (!api || !video) return;
    let disposed = false;
    let binding = false;
    let bound = false;
    let resetRequested = false;
    let lastBatchMediaTime: number | null = null;
    const activeClockEpoch = clockEpoch;
    const activeGeneration = allocateRuntimeGeneration();
    generationRef.current = activeGeneration;
    sequenceRef.current = 0;
    lastResultSequenceRef.current = 0;
    setActiveCues([]);
    const invalidateClockMapping = () => {
      if (disposed || resetRequested) return;
      resetRequested = true;
      lastResultSequenceRef.current = 0;
      setActiveCues([]);
      setClockEpoch((epoch) => Math.max(epoch, activeClockEpoch) + 1);
    };
    const updateCueClock = () => {
      setActiveCues((currentCues) => {
        const currentCue = currentCues[0];
        if (!currentCue) return currentCues;
        const nextCue = advanceLocalCaptionCue(currentCue, video.currentTime);
        return nextCue === currentCue ? currentCues : [nextCue];
      });
    };
    const controller = new LocalAudioCaptureController({
      initialPresentation: presentationRef.current,
      onBatch: (batch) => {
        if (disposed || audioSendPendingRef.current) return;
        if (
          lastBatchMediaTime !== null &&
          (batch.mediaTime < lastBatchMediaTime - 0.5 || batch.mediaTime > lastBatchMediaTime + 2)
        ) {
          invalidateClockMapping();
          return;
        }
        lastBatchMediaTime = batch.mediaTime;
        const sequence = ++sequenceRef.current;
        audioSendPendingRef.current = true;
        void api
          .pushAudio({
            sessionId,
            generation: activeGeneration,
            sequence,
            mediaTime: batch.mediaTime,
            sampleRate: 16_000,
            samples: batch.pcm.slice().buffer,
          })
          .finally(() => {
            audioSendPendingRef.current = false;
          });
      },
    });
    controllerRef.current = controller;

    const bind = () => {
      if (disposed || binding || bound) return;
      binding = true;
      void controller
        .bind(video, sessionId)
        .then(() => {
          bound = true;
        })
        .catch((cause) => {
          if (!disposed) {
            selectedRef.current = false;
            setSelected(false);
            setPhase("error");
            setError(
              cause instanceof Error
                ? cause.message
                : translateRef.current("playback.decodedAudioCaptureFailed")
            );
          }
        })
        .finally(() => {
          binding = false;
        });
    };

    setPhase("starting");
    video.addEventListener("seeking", invalidateClockMapping);
    video.addEventListener("emptied", invalidateClockMapping);
    video.addEventListener("timeupdate", updateCueClock);
    void api
      .start(sessionId, activeGeneration)
      .then((result) => {
        if (disposed) return;
        if (!result.success) {
          selectedRef.current = false;
          setSelected(false);
          setPhase("error");
          setError(result.error ?? translateRef.current("playback.localCaptionsStartFailed"));
          return;
        }
        video.addEventListener("playing", bind);
        if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) bind();
      })
      .catch((cause) => {
        if (disposed) return;
        selectedRef.current = false;
        setSelected(false);
        setPhase("error");
        setError(
          cause instanceof Error
            ? cause.message
            : translateRef.current("playback.localCaptionsStartFailed")
        );
      });

    return () => {
      disposed = true;
      video.removeEventListener("playing", bind);
      video.removeEventListener("seeking", invalidateClockMapping);
      video.removeEventListener("emptied", invalidateClockMapping);
      video.removeEventListener("timeupdate", updateCueClock);
      controllerRef.current = null;
      audioSendPendingRef.current = false;
      void controller.dispose();
      void api.stop(sessionId, activeGeneration);
    };
  }, [
    allowLocalCaptions,
    captionPreferences?.localModelId,
    clockEpoch,
    hasSource,
    modelState.phase,
    selected,
    sessionId,
    videoRef,
  ]);

  const selectLocal = useCallback(async (): Promise<boolean> => {
    if (!allowLocalCaptions) return false;
    if (modelState.phase !== "ready") return false;
    if (selectedRef.current) return true;
    generationRef.current = 0;
    sequenceRef.current = 0;
    lastResultSequenceRef.current = 0;
    selectedRef.current = true;
    setActiveCues([]);
    setError(null);
    setSelected(true);
    const currentPreferences =
      useAuthStore.getState().preferences?.captions ?? DEFAULT_CAPTION_PREFERENCES;
    await updatePreferences({
      captions: {
        ...currentPreferences,
        enabled: true,
        source: "local",
        preferredLanguage: modelState.languageTag,
        localModelId: LOCAL_CAPTION_MODEL_ID,
      },
    });
    return true;
  }, [allowLocalCaptions, modelState.languageTag, modelState.phase, updatePreferences]);

  const stop = useCallback(async (): Promise<void> => {
    deactivate();
    if (!allowLocalCaptions) return;
    const currentPreferences =
      useAuthStore.getState().preferences?.captions ?? DEFAULT_CAPTION_PREFERENCES;
    await updatePreferences({
      captions: { ...currentPreferences, enabled: false },
    });
  }, [allowLocalCaptions, deactivate, updatePreferences]);

  useEffect(() => {
    controllerRef.current?.setPresentation(muted, volume);
  }, [muted, volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!selected || !video) {
      isPictureInPictureRef.current = false;
      clearNativeCaptionTrack(nativeCaptionTrackRef.current);
      return;
    }
    const enterPictureInPicture = () => {
      isPictureInPictureRef.current = true;
      syncNativeCaptionTrack(video, nativeCaptionTrackRef, activeCuesRef.current);
    };
    const leavePictureInPicture = () => {
      isPictureInPictureRef.current = false;
      clearNativeCaptionTrack(nativeCaptionTrackRef.current);
    };
    video.addEventListener("enterpictureinpicture", enterPictureInPicture);
    video.addEventListener("leavepictureinpicture", leavePictureInPicture);
    const captionTrackRef = nativeCaptionTrackRef;
    return () => {
      video.removeEventListener("enterpictureinpicture", enterPictureInPicture);
      video.removeEventListener("leavepictureinpicture", leavePictureInPicture);
      isPictureInPictureRef.current = false;
      clearNativeCaptionTrack(captionTrackRef.current);
    };
  }, [selected, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!selected || !video || !isPictureInPictureRef.current) return;
    syncNativeCaptionTrack(video, nativeCaptionTrackRef, activeCues);
  }, [activeCues, selected, videoRef]);

  const downloadModel = useCallback(async () => {
    const result = await window.electronAPI.localCaptions.downloadModel();
    if (result.state) setModelState(result.state);
    if (!result.success) {
      setError(result.error ?? translateRef.current("playback.captionModelDownloadFailed"));
    }
    return result.success;
  }, []);

  const cancelModelDownload = useCallback(async () => {
    await window.electronAPI.localCaptions.cancelModelDownload();
  }, []);

  const removeModel = useCallback(async () => {
    deactivate();
    const result = await window.electronAPI.localCaptions.removeModel();
    if (result.state) setModelState(result.state);
    if (!result.success) {
      setError(result.error ?? translateRef.current("playback.captionModelRemovalFailed"));
    }
    const preferences = useAuthStore.getState().preferences?.captions;
    if (allowLocalCaptions && preferences?.enabled && preferences.source === "local") {
      selectedRef.current = true;
      setSelected(true);
      setPhase("install-required");
    }
  }, [allowLocalCaptions, deactivate]);

  const retry = useCallback(async () => {
    setError(null);
    if (modelState.phase === "ready") return selectLocal();
    return downloadModel();
  }, [downloadModel, modelState.phase, selectLocal]);

  return {
    modelState,
    selected,
    phase,
    activeCues,
    error,
    selectLocal,
    stop,
    suspend: deactivate,
    downloadModel,
    cancelModelDownload,
    removeModel,
    retry,
  };
}
