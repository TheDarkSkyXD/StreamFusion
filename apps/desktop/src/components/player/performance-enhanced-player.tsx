/**
 * Performance-Enhanced Live Player Wrapper
 *
 * This component demonstrates how to integrate the Phase 3.7 performance
 * optimization hooks with existing live players.
 *
 * Features:
 * - Adaptive quality based on network conditions
 * - Background throttling when app is not visible
 * - Optimized video element lifecycle management
 *
 * @example
 * ```tsx
 * <PerformanceEnhancedPlayer
 *   platform="kick"
 *   streamUrl="https://..."
 *   channelName="xqc"
 *   enableAdaptiveQuality={true}
 *   enableBackgroundThrottle={true}
 *   throttleAction="mute"  // or 'pause' for more aggressive saving
 * />
 * ```
 */

import type Hls from "hls.js";
import { useCallback, useRef, useState } from "react";

import type { Platform } from "@/shared/auth-types";

import { useAdaptiveQuality } from "./hooks/use-adaptive-quality";
import { type ThrottleAction, useBackgroundThrottle } from "./hooks/use-background-throttle";
import { useVideoLifecycle } from "./hooks/use-video-lifecycle";
import { KickLivePlayer } from "./kick/kick-live-player";
import { TwitchLivePlayer } from "./twitch/twitch-live-player";
import type { PlayerError, QualityLevel } from "./types";

export interface PerformanceEnhancedPlayerProps {
  /** Streaming platform */
  platform: Platform;
  /** Stream URL */
  streamUrl: string;
  /** Channel name (required for Twitch ad-blocking) */
  channelName: string;
  /** Auto-play on load */
  autoPlay?: boolean;
  /** Initial muted state */
  muted?: boolean;
  /** Poster image */
  poster?: string;
  /** Additional CSS class */
  className?: string;

  // Performance options
  /** Enable adaptive quality (default: true) */
  enableAdaptiveQuality?: boolean;
  /** Enable background throttling (default: true) */
  enableBackgroundThrottle?: boolean;
  /** Throttle action when backgrounded (default: 'mute') */
  throttleAction?: ThrottleAction;
  /** Grace period before throttling (ms, default: 5000) */
  throttleGracePeriod?: number;

  // Theater mode
  isTheater?: boolean;
  onToggleTheater?: () => void;

  // Callbacks
  onReady?: () => void;
  onError?: (error: PlayerError) => void;
  onQualityChange?: (quality: QualityLevel) => void;
}

export function PerformanceEnhancedPlayer({
  platform,
  streamUrl,
  channelName,
  autoPlay = true,
  muted = false,
  poster,
  className,
  enableAdaptiveQuality = true,
  enableBackgroundThrottle = true,
  throttleAction = "mute",
  throttleGracePeriod = 5000,
  isTheater,
  onToggleTheater,
  onReady,
  onError,
  onQualityChange,
}: PerformanceEnhancedPlayerProps) {
  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // State
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQualityId, setCurrentQualityId] = useState<string>("auto");

  // Handle quality change from adaptive quality hook or manual change
  const handleQualityChange = useCallback(
    (qualityId: string) => {
      setCurrentQualityId(qualityId);

      // Find the quality level and notify parent
      const level = qualities.find((q) => q.id === qualityId);
      if (level && onQualityChange) {
        onQualityChange(level);
      }
    },
    [qualities, onQualityChange]
  );

  // Adaptive Quality Hook
  const { effectiveType, bufferHealth, wasAutoAdjusted, recommendedTier } = useAdaptiveQuality({
    qualities,
    currentQualityId,
    onQualityChange: handleQualityChange,
    hlsRef,
    videoRef,
    enabled: enableAdaptiveQuality,
  });

  // Background Throttle Hook
  const { isVisible, isThrottled, activeAction } = useBackgroundThrottle({
    videoRef,
    enabled: enableBackgroundThrottle,
    throttleAction,
    gracePeriod: throttleGracePeriod,
    onQualityChange: handleQualityChange,
    currentQualityId,
    qualities,
  });

  // Video Lifecycle Hook — always active for live streams; never let visibility pause playback
  useVideoLifecycle({
    videoRef,
    hlsRef,
    src: streamUrl,
    isActive: true,
    preloadStrategy: "metadata",
  });

  // Handle quality level updates from player
  const _handleQualityLevels = useCallback((levels: QualityLevel[]) => {
    setQualities(levels);
  }, []);

  // Log performance state changes (for debugging)
  if (process.env.NODE_ENV === "development") {
    console.debug("[PerformanceEnhancedPlayer] State:", {
      effectiveType,
      bufferHealth,
      recommendedTier,
      wasAutoAdjusted,
      isThrottled,
      activeAction,
      isVisible,
    });
  }

  // Common player props
  const playerProps = {
    streamUrl,
    poster,
    autoPlay,
    muted: muted || isThrottled,
    className,
    isTheater,
    onToggleTheater,
    onReady,
    onError,
    channelName,
  };

  // Render platform-specific player
  // Note: In a full integration, we would also pass refs for video/hls
  // and quality handlers. This example shows the hook configuration.
  if (platform === "kick") {
    return (
      <KickLivePlayer
        {...playerProps}
        onQualityChange={(q) => {
          setCurrentQualityId(q.id);
          onQualityChange?.(q);
        }}
      />
    );
  }

  return (
    <TwitchLivePlayer
      {...playerProps}
      onQualityChange={(q) => {
        setCurrentQualityId(q.id);
        onQualityChange?.(q);
      }}
    />
  );
}

/**
 * Performance status indicator component
 * Shows current performance optimization state
 */
export function PerformanceIndicator({
  bufferHealth,
  isThrottled,
  wasAutoAdjusted,
  effectiveType,
}: {
  bufferHealth: "good" | "low" | "critical";
  isThrottled: boolean;
  wasAutoAdjusted: boolean;
  effectiveType: string | null;
}) {
  const healthColors = {
    good: "bg-green-500",
    low: "bg-yellow-500",
    critical: "bg-red-500",
  };

  return (
    <div className="absolute top-2 right-2 z-50 flex items-center gap-2 text-xs text-white bg-black/60 px-2 py-1 rounded">
      {/* Buffer Health */}
      <div className="flex items-center gap-1">
        <div className={`w-2 h-2 rounded-full ${healthColors[bufferHealth]}`} />
        <span className="opacity-70">Buffer</span>
      </div>

      {/* Throttle Status */}
      {isThrottled && <span className="text-yellow-400">⚡ Throttled</span>}

      {/* Auto-adjusted Quality */}
      {wasAutoAdjusted && <span className="text-blue-400">📊 Auto</span>}

      {/* Network Type */}
      {effectiveType && <span className="opacity-50">{effectiveType}</span>}
    </div>
  );
}
