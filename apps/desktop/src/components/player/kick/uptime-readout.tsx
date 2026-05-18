import type Hls from "hls.js";
import type React from "react";
import { useEffect } from "react";

import type { KickProgressBarHandle } from "./kick-progress-bar";

export interface UptimeReadoutProps {
  startedAt?: string | null;
  isPlaying: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  hlsRef: React.RefObject<Hls | null>;
  progressBarRef: React.RefObject<KickProgressBarHandle | null>;
  currentTimeRef: React.MutableRefObject<number>;
}

/**
 * Owns the 1Hz uptime tick for the Kick live player. Reports the computed
 * currentTime/duration/seekableRange to the progress bar via an imperative
 * ref so the player tree never reconciles for time updates. This used to be
 * a setInterval in `kick-live-player.tsx` driving three setState calls per
 * tick — over a 9h session that was 32,400 commits of the entire player
 * subtree.
 */
export function UptimeReadout({
  startedAt,
  isPlaying,
  videoRef,
  hlsRef,
  progressBarRef,
  currentTimeRef,
}: UptimeReadoutProps) {
  useEffect(() => {
    if (!isPlaying) return;

    const tick = () => {
      const video = videoRef.current;
      if (!video) return;

      let currentTime = 0;
      let duration = 0;
      let seekableRange: { start: number; end: number } | null = null;

      if (startedAt) {
        const now = Date.now();
        const start = new Date(startedAt).getTime();
        const uptime = (now - start) / 1000;
        duration = uptime;

        const hls = hlsRef.current;
        if (hls?.playingDate) {
          // Precise absolute time from HLS Program Date Time
          currentTime = (hls.playingDate.getTime() - start) / 1000;

          if (video.seekable.length > 0) {
            const seekableStartVideo = video.seekable.start(0);
            const seekableEndVideo = video.seekable.end(video.seekable.length - 1);
            const offset = currentTime - video.currentTime;
            seekableRange = {
              start: seekableStartVideo + offset,
              end: seekableEndVideo + offset,
            };
          }
        } else if (video.seekable.length > 0) {
          // Fallback: assume seekable.end == "now" (uptime).
          const seekableEnd = video.seekable.end(video.seekable.length - 1);
          const secondsFromLive = seekableEnd - video.currentTime;
          currentTime = Math.max(0, uptime - secondsFromLive);

          const windowDuration = seekableEnd - video.seekable.start(0);
          seekableRange = {
            start: Math.max(0, uptime - windowDuration),
            end: uptime,
          };
        }
      } else {
        // No startedAt — fall back to the video element's own clock.
        currentTime = video.currentTime;
        duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      }

      currentTimeRef.current = currentTime;
      progressBarRef.current?.update({ currentTime, duration, seekableRange });
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt, isPlaying, videoRef, hlsRef, progressBarRef, currentTimeRef]);

  return null;
}
