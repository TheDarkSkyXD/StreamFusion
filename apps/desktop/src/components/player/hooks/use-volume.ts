import { useCallback, useEffect, useRef } from "react";

import { useVolumeStore } from "../../../store/volume-store";

interface UseVolumeOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  initialMuted?: boolean;
  watch?: any; // Dependency to trigger re-application (e.g. streamUrl)
  forcedMuted?: boolean; // External override to force mute (e.g. when clip dialog is open)
}

/**
 * Hook for managing persistent volume across all players.
 * Syncs volume state with the global store and the video element.
 */
export function useVolume({
  videoRef,
  initialMuted = false,
  watch,
  forcedMuted = false,
}: UseVolumeOptions) {
  const { volume, isMuted: storeMuted, setVolume, setMuted, toggleMute } = useVolumeStore();
  const isFirstMount = useRef(true);
  const isApplyingFromStore = useRef(false);

  // Calculate effective muted state (store preference OR forced override)
  const isEffectiveMuted = forcedMuted || storeMuted;

  // Apply stored volume and handle initial muted state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Block syncFromVideoElement during HLS init window to prevent
    // HLS.js volume reset from corrupting the store
    isApplyingFromStore.current = true;
    const timer = setTimeout(() => {
      isApplyingFromStore.current = false;
    }, 100);

    video.volume = volume / 100;

    // On first mount, determine muted state from forcedMuted/store; afterward use effective state
    if (isFirstMount.current) {
      // If forcedMuted, start muted without saving to store
      // Otherwise respect the store's persisted preference
      const startMuted = forcedMuted || storeMuted;
      video.muted = startMuted;

      // Don't update store on mount - it already has the user's preference
      // (Store initialization with initialMuted should happen in the store itself)

      isFirstMount.current = false;
    } else {
      video.muted = isEffectiveMuted;
    }

    return () => {
      clearTimeout(timer);
    };
  }, [videoRef, volume, storeMuted, forcedMuted, isEffectiveMuted, watch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle volume change from UI
  const handleVolumeChange = useCallback(
    (volumeOrFn: number | ((prev: number) => number)) => {
      const video = videoRef.current;
      if (!video) return;

      // Calculate new volume
      // We use video.volume * 100 as the source of truth for "previous" volume
      // to ensure we're stepping from the actual current level
      const currentVol = video.volume * 100;
      const newVolume = typeof volumeOrFn === "function" ? volumeOrFn(currentVol) : volumeOrFn;

      const vol = Math.max(0, Math.min(100, newVolume));
      video.volume = vol / 100;
      setVolume(vol); // Store handles its own clamping/functional update but we pass the resolved value here

      // If user changes volume while muted (and not forced), unmute
      // If forced muted, we allow volume change but stay muted
      if (vol > 0 && video.muted && !forcedMuted) {
        video.muted = false;
        setMuted(false);
      }
      if (vol === 0) {
        video.muted = true;
        setMuted(true);
      }
    },
    [setVolume, setMuted, forcedMuted, videoRef.current]
  );

  // Handle mute toggle from UI
  const handleToggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Block mute toggle when forcedMuted is active to prevent
    // user confusion (video would remain muted regardless)

    if (forcedMuted) return;

    video.muted = !video.muted;
    setMuted(video.muted);
  }, [setMuted, forcedMuted, videoRef.current]);

  // Sync store when video element fires volumechange event
  const syncFromVideoElement = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    // Ignore volumechange events fired during the HLS init window to prevent
    // HLS.js volume reset from overwriting the user's stored preference
    if (isApplyingFromStore.current) return;

    // Do not sync mute state if forced, as it doesn't reflect user preference
    if (!forcedMuted) {
      setMuted(video.muted);
    }
    setVolume(video.volume * 100);
  }, [setVolume, setMuted, forcedMuted, videoRef.current]);

  return {
    volume,
    isMuted: isEffectiveMuted, // Return effective mute state so UI reflects it
    handleVolumeChange,
    handleToggleMute,
    syncFromVideoElement,
  };
}
