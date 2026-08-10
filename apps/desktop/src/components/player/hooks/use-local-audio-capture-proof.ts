import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { logger } from "@/renderer/logging/logger";

import { LocalAudioCaptureController } from "../local-audio-capture";

const NON_SILENT_RMS = 0.000_01;

/**
 * Development-only evidence that the player's decoded program audio can feed
 * local captions. This probe never records audio or logs PCM/content: only
 * sample counts and RMS.
 */
export function useLocalAudioCaptureProof(
  videoRef: RefObject<HTMLVideoElement | null>,
  mediaKey: string,
  sourceKey: string,
  muted: boolean,
  volume: number
): string | null {
  const [proof, setProof] = useState<string | null>(null);
  const controllerRef = useRef<LocalAudioCaptureController | null>(null);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  useLayoutEffect(() => {
    mutedRef.current = muted;
    volumeRef.current = volume;
  }, [muted, volume]);

  useEffect(() => {
    if (!import.meta.env.DEV || !sourceKey) return;

    const video = videoRef.current;
    if (!video) return;

    let binding = false;
    let bound = false;
    let disposed = false;
    let loggedNonSilentProof = false;
    let lastProvenMuted: boolean | null = null;
    let diagnosticTimer: number | null = null;
    const controller = new LocalAudioCaptureController({
      initialPresentation: { muted: mutedRef.current, volume: volumeRef.current },
      onBatch: (batch) => {
        if (disposed) return;
        video.dataset.localAudioCaptureState = "active";
        video.dataset.localAudioCaptureGeneration = String(batch.generation);
        video.dataset.localAudioRms = batch.rms.toFixed(6);
        video.dataset.localAudioSampleRate = String(batch.sampleRate);

        if (
          batch.rms > NON_SILENT_RMS &&
          (!loggedNonSilentProof || lastProvenMuted !== mutedRef.current)
        ) {
          loggedNonSilentProof = true;
          lastProvenMuted = mutedRef.current;
          if (diagnosticTimer !== null) {
            window.clearInterval(diagnosticTimer);
            diagnosticTimer = null;
          }
          const platform = mediaKey.split(":", 1)[0];
          setProof(
            `AUDIO LIVE ${platform} g${batch.generation} ${batch.sampleRate / 1000}k RMS ${batch.rms.toFixed(4)} ${mutedRef.current ? "MUTED" : "AUDIBLE"} ${controller.diagnostic}`
          );
          logger.info("Player:LocalAudioCapture", "decoded program audio is non-silent", {
            mediaKey,
            generation: batch.generation,
            mediaTime: Number(batch.mediaTime.toFixed(3)),
            muted: mutedRef.current,
            rms: Number(batch.rms.toFixed(6)),
            sampleCount: batch.pcm.length,
            sampleRate: batch.sampleRate,
          });
        }
      },
    });
    controllerRef.current = controller;

    const start = () => {
      if (binding || bound || disposed) return;
      binding = true;
      setProof(`AUDIO START ${mediaKey.split(":", 1)[0]}`);
      video.dataset.localAudioCaptureState = "starting";
      void controller
        .bind(video, mediaKey)
        .then((generation) => {
          if (!disposed) {
            bound = true;
            if (!loggedNonSilentProof) {
              setProof(
                `AUDIO TAP ${mediaKey.split(":", 1)[0]} g${generation} ${mutedRef.current ? "MUTED" : "AUDIBLE"} ${controller.diagnostic}`
              );
              // timer-allowlist: dev proof refresh while the tap waits for non-silent samples
              diagnosticTimer = window.setInterval(() => {
                if (!disposed && !loggedNonSilentProof) {
                  setProof(
                    `AUDIO TAP ${mediaKey.split(":", 1)[0]} g${generation} ${mutedRef.current ? "MUTED" : "AUDIBLE"} ${controller.diagnostic}`
                  );
                }
              }, 1000);
            }
          }
        })
        .catch((error) => {
          if (disposed) return;
          const errorName = error instanceof Error ? error.name : "Error";
          video.dataset.localAudioCaptureState = "waiting";
          setProof(`AUDIO WAIT ${mediaKey.split(":", 1)[0]} ${errorName}`);
          logger.debug("Player:LocalAudioCapture", "decoded audio tap is waiting for playback", {
            mediaKey,
            error,
          });
        })
        .finally(() => {
          binding = false;
        });
    };

    video.addEventListener("playing", start);
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) start();

    return () => {
      disposed = true;
      video.removeEventListener("playing", start);
      if (diagnosticTimer !== null) window.clearInterval(diagnosticTimer);
      delete video.dataset.localAudioCaptureState;
      delete video.dataset.localAudioCaptureGeneration;
      delete video.dataset.localAudioRms;
      delete video.dataset.localAudioSampleRate;
      void controller.stop();
    };
  }, [mediaKey, sourceKey, videoRef]);

  useEffect(() => {
    controllerRef.current?.setPresentation(muted, volume);
  }, [muted, volume]);

  useEffect(
    () => () => {
      const controller = controllerRef.current;
      controllerRef.current = null;
      void controller?.dispose();
    },
    []
  );

  return proof;
}
