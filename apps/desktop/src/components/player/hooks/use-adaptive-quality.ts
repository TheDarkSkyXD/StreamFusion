/**
 * useAdaptiveQuality Hook
 *
 * Monitors network conditions and buffer health to automatically adjust stream quality.
 * Uses the Network Information API (where available) and buffer stall detection to
 * determine when quality should be reduced to maintain smooth playback.
 *
 * Features:
 * - Network Information API monitoring (downlink, effectiveType, rtt)
 * - Buffer health monitoring (stall detection)
 * - Hysteresis to prevent quality oscillation
 * - Configurable thresholds for quality tiers
 *
 * @module player/use-adaptive-quality
 */

import type Hls from "hls.js";
import { useCallback, useEffect, useRef, useState } from "react";

import { useInterval } from "@/hooks/useInterval";

import type { QualityLevel } from "../types";

// Network Information API types (not in default TypeScript lib)
interface NetworkInformation extends EventTarget {
  downlink: number; // Mbps
  effectiveType: "slow-2g" | "2g" | "3g" | "4g";
  rtt: number; // ms
  saveData: boolean;
  onchange: ((this: NetworkInformation, ev: Event) => void) | null;
}

declare global {
  interface Navigator {
    connection?: NetworkInformation;
    mozConnection?: NetworkInformation;
    webkitConnection?: NetworkInformation;
  }
}

export interface AdaptiveQualityOptions {
  /** Available quality levels from HLS manifest */
  qualities: QualityLevel[];
  /** Current quality level ID */
  currentQualityId: string;
  /** Callback to change quality */
  onQualityChange: (qualityId: string) => void;
  /** Reference to HLS instance for buffer monitoring */
  hlsRef: React.RefObject<Hls | null>;
  /** Reference to video element */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Whether adaptive quality is enabled (default: true) */
  enabled?: boolean;
  /** Minimum buffer before considering quality reduction (seconds, default: 5) */
  minBufferThreshold?: number;
  /** Cooldown between quality changes (ms, default: 10000) */
  changeCooldown?: number;
}

export interface AdaptiveQualityState {
  /** Current network effective type */
  effectiveType: string | null;
  /** Current downlink speed in Mbps */
  downlink: number | null;
  /** Round-trip time in ms */
  rtt: number | null;
  /** Whether data saver is enabled */
  saveData: boolean;
  /** Current buffer health status */
  bufferHealth: "good" | "low" | "critical";
  /** Whether quality was auto-adjusted */
  wasAutoAdjusted: boolean;
  /** Recommended quality tier based on conditions */
  recommendedTier: "high" | "medium" | "low" | "auto";
}

// Quality tier thresholds
// high: For good connections, selects highest available quality (1080p, 4K, etc.)
// medium/low: Caps at specific heights to reduce bandwidth
const QUALITY_TIERS = {
  high: { minDownlink: 10, maxRtt: 100 }, // No height cap - use highest available
  medium: { minDownlink: 5, maxRtt: 200, maxHeight: 720 }, // Cap at 720p
  low: { minDownlink: 1, maxRtt: 500, maxHeight: 360 }, // Cap at 360p
};

// Map effective connection type to recommended tier
const EFFECTIVE_TYPE_MAP: Record<string, "high" | "medium" | "low"> = {
  "4g": "high",
  "3g": "medium",
  "2g": "low",
  "slow-2g": "low",
};

/**
 * Hook to automatically adjust stream quality based on network conditions
 */
export function useAdaptiveQuality({
  qualities,
  currentQualityId,
  onQualityChange,
  hlsRef,
  videoRef,
  enabled = true,
  minBufferThreshold = 5,
  changeCooldown = 10000,
}: AdaptiveQualityOptions): AdaptiveQualityState {
  const [state, setState] = useState<AdaptiveQualityState>({
    effectiveType: null,
    downlink: null,
    rtt: null,
    saveData: false,
    bufferHealth: "good",
    wasAutoAdjusted: false,
    recommendedTier: "auto",
  });

  const lastChangeTimeRef = useRef<number>(0);
  const stallCountRef = useRef<number>(0);
  const isAutoQualityRef = useRef<boolean>(currentQualityId === "auto");

  // Get network connection object
  const getConnection = useCallback((): NetworkInformation | null => {
    return navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  }, []);

  // Determine recommended tier based on current conditions
  const getRecommendedTier = useCallback(
    (
      downlink: number | null,
      rtt: number | null,
      effectiveType: string | null,
      bufferHealth: "good" | "low" | "critical"
    ): "high" | "medium" | "low" | "auto" => {
      // If buffer is critical, force low quality
      if (bufferHealth === "critical") {
        return "low";
      }

      // If we have Network Information API data
      if (downlink !== null && rtt !== null) {
        if (downlink >= QUALITY_TIERS.high.minDownlink && rtt <= QUALITY_TIERS.high.maxRtt) {
          return bufferHealth === "good" ? "high" : "medium";
        }
        if (downlink >= QUALITY_TIERS.medium.minDownlink && rtt <= QUALITY_TIERS.medium.maxRtt) {
          return bufferHealth === "good" ? "medium" : "low";
        }
        return "low";
      }

      // Fall back to effectiveType if available
      if (effectiveType && effectiveType in EFFECTIVE_TYPE_MAP) {
        const tier = EFFECTIVE_TYPE_MAP[effectiveType];
        // Downgrade by one tier if buffer is low
        if (bufferHealth === "low") {
          if (tier === "high") return "medium";
          if (tier === "medium") return "low";
        }
        return tier;
      }

      // Default to auto (let HLS.js handle it)
      return "auto";
    },
    []
  );

  // Find a quality level matching the recommended tier
  const findQualityForTier = useCallback(
    (
      tier: "high" | "medium" | "low" | "auto",
      availableQualities: QualityLevel[]
    ): string | null => {
      if (tier === "auto" || availableQualities.length === 0) {
        return "auto";
      }

      // Get non-auto qualities sorted by height descending (highest first)
      const sortedQualities = [...availableQualities]
        .filter((q) => !q.isAuto && q.height > 0)
        .sort((a, b) => b.height - a.height);

      if (sortedQualities.length === 0) {
        return "auto";
      }

      // For high tier: return the highest available quality (supports 4K, 1440p, etc.)
      if (tier === "high") {
        return sortedQualities[0].id;
      }

      // For medium/low tiers: find the best quality within the height cap
      const maxHeight = QUALITY_TIERS[tier].maxHeight;

      // Find highest quality <= maxHeight
      for (const quality of sortedQualities) {
        if (quality.height <= maxHeight) {
          return quality.id;
        }
      }

      // Fallback to lowest quality if nothing matches
      return sortedQualities[sortedQualities.length - 1].id;
    },
    []
  );

  // Check buffer health
  const checkBufferHealth = useCallback((): "good" | "low" | "critical" => {
    const video = videoRef.current;
    if (!video) return "good";

    const buffered = video.buffered;
    if (buffered.length === 0) return "critical";

    // Find the buffer range that contains current time
    let bufferAhead = 0;
    for (let i = 0; i < buffered.length; i++) {
      if (buffered.start(i) <= video.currentTime && buffered.end(i) >= video.currentTime) {
        bufferAhead = buffered.end(i) - video.currentTime;
        break;
      }
    }

    if (bufferAhead < 2) return "critical";
    if (bufferAhead < minBufferThreshold) return "low";
    return "good";
  }, [videoRef, minBufferThreshold]);

  // Update network state
  const updateNetworkState = useCallback(() => {
    const connection = getConnection();
    const bufferHealth = checkBufferHealth();

    const newState = {
      effectiveType: connection?.effectiveType || null,
      downlink: connection?.downlink || null,
      rtt: connection?.rtt || null,
      saveData: connection?.saveData || false,
      bufferHealth,
    };

    const recommendedTier = getRecommendedTier(
      newState.downlink,
      newState.rtt,
      newState.effectiveType,
      bufferHealth
    );

    setState((prev) => ({
      ...prev,
      ...newState,
      recommendedTier,
    }));

    return { ...newState, recommendedTier };
  }, [getConnection, checkBufferHealth, getRecommendedTier]);

  // Handle quality adjustment
  const maybeAdjustQuality = useCallback(() => {
    if (!enabled || qualities.length === 0) return;

    // Only auto-adjust if currently on 'auto' quality
    if (!isAutoQualityRef.current) return;

    const now = Date.now();
    if (now - lastChangeTimeRef.current < changeCooldown) return;

    const { recommendedTier, bufferHealth, saveData } = updateNetworkState();

    // Force low quality if data saver is on
    const effectiveTier = saveData ? "low" : recommendedTier;

    // Only adjust for non-auto recommendations or critical conditions
    if (effectiveTier === "auto" && bufferHealth !== "critical") return;

    const targetQualityId = findQualityForTier(effectiveTier, qualities);

    if (targetQualityId && targetQualityId !== currentQualityId && targetQualityId !== "auto") {
      console.debug(
        `[AdaptiveQuality] Adjusting quality: ${currentQualityId} -> ${targetQualityId} (tier: ${effectiveTier}, buffer: ${bufferHealth})`
      );

      onQualityChange(targetQualityId);
      lastChangeTimeRef.current = now;

      setState((prev) => ({ ...prev, wasAutoAdjusted: true }));
    }
  }, [
    enabled,
    qualities,
    currentQualityId,
    onQualityChange,
    changeCooldown,
    updateNetworkState,
    findQualityForTier,
  ]);

  // Track if user is on auto quality
  useEffect(() => {
    isAutoQualityRef.current = currentQualityId === "auto";

    // Reset auto-adjusted flag when user manually changes quality
    if (currentQualityId !== "auto") {
      setState((prev) => ({ ...prev, wasAutoAdjusted: false }));
    }
  }, [currentQualityId]);

  // Monitor buffer stalls
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return;

    const handleStall = () => {
      stallCountRef.current++;
      console.debug("[AdaptiveQuality] Buffer stall detected, count:", stallCountRef.current);

      // After 2 stalls, consider quality adjustment
      if (stallCountRef.current >= 2) {
        maybeAdjustQuality();
      }
    };

    const handlePlaying = () => {
      // Reset stall count when playback resumes smoothly
      if (stallCountRef.current > 0) {
        stallCountRef.current--;
      }
    };

    video.addEventListener("waiting", handleStall);
    video.addEventListener("playing", handlePlaying);

    return () => {
      video.removeEventListener("waiting", handleStall);
      video.removeEventListener("playing", handlePlaying);
    };
  }, [enabled, videoRef, maybeAdjustQuality]);

  // Monitor network changes
  useEffect(() => {
    if (!enabled) return;

    const connection = getConnection();
    if (!connection) {
      // No Network Information API, rely on buffer monitoring only
      return;
    }

    const handleConnectionChange = () => {
      console.debug("[AdaptiveQuality] Network change detected");
      maybeAdjustQuality();
    };

    connection.addEventListener("change", handleConnectionChange);

    // Initial check
    updateNetworkState();

    return () => {
      connection.removeEventListener("change", handleConnectionChange);
    };
  }, [enabled, getConnection, updateNetworkState, maybeAdjustQuality]);

  // Periodic buffer health check every 2 seconds
  useInterval(() => {
    const health = checkBufferHealth();
    setState((prev) => {
      if (prev.bufferHealth !== health) {
        // Log significant changes
        if (health === "critical" || prev.bufferHealth === "critical") {
          console.debug(`[AdaptiveQuality] Buffer health: ${prev.bufferHealth} -> ${health}`);
        }
        return { ...prev, bufferHealth: health };
      }
      return prev;
    });

    // Check if we need to adjust quality
    if (health === "critical" || health === "low") {
      maybeAdjustQuality();
    }
  }, enabled ? 2000 : null);

  return state;
}
