import { useCallback, useEffect, useRef } from "react";

import { logger } from "@/renderer/logging/logger";
import type { VideoQuality } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import type { QualityLevel } from "../types";

/**
 * Quality mapping from user preference to resolution heights
 * User preferences: 'auto' | '1080p' | '720p' | '480p' | '360p' | '160p'
 */
const QUALITY_HEIGHT_MAP: Record<Exclude<VideoQuality, "auto">, number> = {
  "1080p": 1080,
  "720p": 720,
  "480p": 480,
  "360p": 360,
  "160p": 160,
};

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
  // Find the best matching quality level for the user's preference
  const findMatchingQuality = useCallback(
    (levels: QualityLevel[]): string => {
      if (defaultQuality === "auto") {
        return "auto";
      }

      const targetHeight = QUALITY_HEIGHT_MAP[defaultQuality];
      if (!targetHeight) {
        return "auto";
      }

      // Available levels excluding 'auto'
      const realLevels = levels.filter((level) => !level.isAuto);

      if (realLevels.length === 0) {
        return "auto";
      }

      // 1. Exact height match
      const exactMatch = realLevels.find((level) => level.height === targetHeight);
      if (exactMatch) {
        return exactMatch.id;
      }

      // 2. Name/Label match (e.g. "1080" in "1080p60")
      // Useful when height is 0 or missing (common with 'Source' quality sometimes)
      const targetString = defaultQuality.replace("p", ""); // "1080", "720", etc.
      const nameMatch = realLevels.find(
        (level) => level.name?.includes(targetString) || level.label.includes(targetString)
      );
      if (nameMatch) {
        return nameMatch.id;
      }

      // 3. Approximate height match (allow small variance)
      const approxMatch = realLevels.find((level) => Math.abs(level.height - targetHeight) < 16);
      if (approxMatch) {
        return approxMatch.id;
      }

      // 4. Closest available quality that doesn't exceed target
      // Filter out invalid heights for this comparison
      const sortedByHeight = realLevels
        .filter((l) => l.height > 0)
        .sort((a, b) => b.height - a.height);

      const lowerOrEqual = sortedByHeight.find((level) => level.height <= targetHeight);
      if (lowerOrEqual) {
        return lowerOrEqual.id;
      }

      // 5. If we only have higher qualities, pick the lowest available (closest to target)
      if (sortedByHeight.length > 0) {
        return sortedByHeight[sortedByHeight.length - 1].id;
      }

      // 6. Fallback: If no heights are available (all 0), try to pick based on bitrate
      // If user wants high quality (1080p/720p), pick highest bitrate
      // If user wants low quality (480p/360p), pick lowest bitrate
      const sortedByBitrate = [...realLevels].sort((a, b) => b.bitrate - a.bitrate);
      if (sortedByBitrate.length > 0) {
        if (targetHeight >= 720) {
          return sortedByBitrate[0].id; // Highest
        } else {
          return sortedByBitrate[sortedByBitrate.length - 1].id; // Lowest
        }
      }

      return "auto";
    },
    [defaultQuality]
  );

  // Apply default quality when qualities first become available
  useEffect(() => {
    // Only apply when we first receive quality levels
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
  }, [qualities, currentQualityId, findMatchingQuality, onQualityChange, defaultQuality]);

  // Reset when component unmounts and remounts (e.g., navigating to different stream)
  useEffect(() => {
    return () => {
      hasAppliedDefaultRef.current = false;
      prevQualitiesLengthRef.current = 0;
    };
  }, []);

  return { defaultQuality };
}
