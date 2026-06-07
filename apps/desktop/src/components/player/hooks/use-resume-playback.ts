import { useCallback, useEffect, useRef } from "react";
import { useInterval } from "@/hooks/useInterval";
import { usePlaybackPositionStore } from "@/store/playback-position-store";

interface UseResumePlaybackOptions {
  platform: "twitch" | "kick";
  videoId: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  title?: string;
  thumbnail?: string;
  enabled?: boolean;
}

/**
 * Hook to handle resume playback functionality for VODs.
 * - Saves playback position periodically
 * - Restores position when returning to a video
 */
export function useResumePlayback({
  platform,
  videoId,
  videoRef,
  title,
  thumbnail,
  enabled = true,
}: UseResumePlaybackOptions) {
  const { getPosition, savePosition } = usePlaybackPositionStore();
  const hasRestoredRef = useRef(false);

  // Restore position when video is ready
  const restorePosition = useCallback(() => {
    if (!enabled || !videoRef.current || hasRestoredRef.current) return;

    const savedPosition = getPosition(platform, videoId);
    if (savedPosition && savedPosition.position > 0) {
      const video = videoRef.current;

      // Only restore if video has loaded enough metadata
      if (video.readyState >= 1 && video.duration > 0) {
        // Don't restore if they were very close to the end
        if (savedPosition.position < video.duration * 0.95) {
          try {
            video.currentTime = savedPosition.position;
            hasRestoredRef.current = true;
          } catch (error) {
            console.error("Failed to restore playback position:", error);
          }
        }
      }
    }
  }, [enabled, platform, videoId, getPosition, videoRef]);

  // Save current position
  const saveCurrentPosition = useCallback(() => {
    if (!enabled || !videoRef.current) return;

    const video = videoRef.current;
    if (video.duration > 0 && video.currentTime > 0) {
      savePosition(platform, videoId, video.currentTime, video.duration, title, thumbnail);
    }
  }, [enabled, platform, videoId, title, thumbnail, savePosition, videoRef]);

  // Store latest callbacks to avoid effect re-runs
  const restorePositionRef = useRef(restorePosition);
  const saveCurrentPositionRef = useRef(saveCurrentPosition);

  useEffect(() => {
    restorePositionRef.current = restorePosition;
    saveCurrentPositionRef.current = saveCurrentPosition;
  }, [restorePosition, saveCurrentPosition]);

  // Setup event listeners and interval saving
  useEffect(() => {
    if (!enabled) return;

    const video = videoRef.current;
    if (!video) return;

    // Restore position when metadata is loaded
    const handleLoadedMetadata = () => {
      restorePositionRef.current();
    };

    // Save on pause
    const handlePause = () => {
      saveCurrentPositionRef.current();
    };

    // Save before leaving
    const handleBeforeUnload = () => {
      saveCurrentPositionRef.current();
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("pause", handlePause);
    window.addEventListener("beforeunload", handleBeforeUnload);

    // If metadata is already loaded, try to restore
    if (video.readyState >= 1) {
      restorePositionRef.current();
    }

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("pause", handlePause);
      window.removeEventListener("beforeunload", handleBeforeUnload);

      // Final save on unmount
      saveCurrentPositionRef.current();
    };
  }, [enabled, videoRef]);

  // Periodic position save every 30 seconds
  useInterval(() => saveCurrentPositionRef.current(), enabled ? 30000 : null);

  // Reset restoration flag when videoId changes
  useEffect(() => {
    hasRestoredRef.current = false;
  }, []);

  return {
    savedPosition: getPosition(platform, videoId),
    saveCurrentPosition,
  };
}
