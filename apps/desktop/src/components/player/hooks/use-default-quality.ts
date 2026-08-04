import { useCallback, useEffect, useRef } from "react";

import { logger } from "@/renderer/logging/logger";
import { useAuthStore } from "@/store/auth-store";

import { resolvePreferredQualityId } from "../quality-preference";
import type { QualityLevel } from "../types";

/**
 * Hook to apply the user's default quality preference when quality levels become available.
 *
 * @param qualities - Available quality levels from HLS
 * @param currentQualityId - Current quality ID state
 * @param onQualityChange - Callback to set the quality
 */
export function useDefaultQuality(
  qualities: QualityLevel[],
  currentQualityId: string,
  onQualityChange: (qualityId: string) => void
) {
  const preferences = useAuthStore((state) => state.preferences);
  const defaultQuality = preferences?.playback?.defaultQuality ?? "auto";

  // Track if we've already applied the default (to avoid overriding user selections)
  const hasAppliedDefaultRef = useRef(false);
  const prevQualitiesLengthRef = useRef(0);

  // Find the best matching quality level for the user's preference
  const findMatchingQuality = useCallback(
    (levels: QualityLevel[]): string => resolvePreferredQualityId(levels, defaultQuality),
    [defaultQuality]
  );

  // Apply default quality when qualities first become available
  useEffect(() => {
    if (
      qualities.length > 0 &&
      !hasAppliedDefaultRef.current &&
      prevQualitiesLengthRef.current === 0
    ) {
      const targetQuality = findMatchingQuality(qualities);

      // Only change if different from current (which defaults to 'auto')
      if (targetQuality !== currentQualityId) {
        logger.debug("Player:Hook:Quality", "applying default quality", {
          defaultQuality,
          targetQuality,
        });
        onQualityChange(targetQuality);
      }

      hasAppliedDefaultRef.current = true;
    }

    prevQualitiesLengthRef.current = qualities.length;
  }, [qualities, currentQualityId, defaultQuality, findMatchingQuality, onQualityChange]);

  // Reset when component unmounts and remounts (e.g., navigating to different stream)
  useEffect(() => {
    return () => {
      hasAppliedDefaultRef.current = false;
      prevQualitiesLengthRef.current = 0;
    };
  }, []);

  return { defaultQuality };
}
