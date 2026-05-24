import { useCallback, useEffect, useRef, useState } from "react";
import { LuMaximize, LuMinimize, LuShieldCheck } from "react-icons/lu";

import type { AdBlockStatus } from "@/shared/adblock-types";
import { DEFAULT_PLAYER_CONTROLS_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { PlayPauseButton } from "../play-pause-button";
import { SettingsMenu } from "../settings-menu";
import type { QualityLevel } from "../types";
import { VolumeControl } from "../volume-control";

import { TwitchProgressBar } from "./twitch-progress-bar";

const TheaterOutlineIcon = ({ className }: { className?: string }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <line x1="15" x2="15" y1="3" y2="21" />
  </svg>
);

const TheaterFilledIcon = ({ className }: { className?: string }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4V3z" fill="currentColor" stroke="none" />
    <line x1="15" x2="15" y1="3" y2="21" />
  </svg>
);

interface TwitchLivePlayerControlsProps {
  // Playback state
  isPlaying: boolean;
  isLoading?: boolean;

  // Volume state
  volume: number;
  muted: boolean;

  // Quality state
  qualities: QualityLevel[];
  currentQualityId: string;

  // View states
  isFullscreen: boolean;
  isTheater?: boolean;

  // Handlers
  onTogglePlay: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onQualityChange: (qualityId: string) => void;
  onToggleFullscreen: () => void;
  onToggleTheater?: () => void;
  onTogglePip?: () => void;

  // Playback Speed
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;

  // Stats
  showVideoStats?: boolean;
  onToggleVideoStats?: () => void;

  // AdBlock
  adBlockStatus?: AdBlockStatus | null;

  // Progress
  onSeek?: (time: number) => void;
}

export function TwitchLivePlayerControls(props: TwitchLivePlayerControlsProps) {
  const {
    isPlaying,
    isLoading,
    volume,
    muted,
    qualities,
    currentQualityId,
    isFullscreen,
    isTheater,
    onTogglePlay,
    onVolumeChange,
    onToggleMute,
    onQualityChange,
    onToggleFullscreen,
    onToggleTheater,
    onTogglePip,
    showVideoStats,
    onToggleVideoStats,
    adBlockStatus,
    onSeek,
  } = props;

  const controls =
    useAuthStore((s) => s.preferences?.playerControls) ?? DEFAULT_PLAYER_CONTROLS_PREFERENCES;

  const [isVisible, setIsVisible] = useState(true);
  const hideTimeoutRef = useRef<NodeJS.Timeout>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isHoveringControlsRef = useRef(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Clear timeout helper
  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Start idle timeout
  const startIdleTimeout = useCallback(() => {
    clearHideTimeout();
    if (isPlaying && !isSettingsOpen) {
      const timeout = isHoveringControlsRef.current ? 3000 : 1000;
      hideTimeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, timeout);
    }
  }, [isPlaying, clearHideTimeout, isSettingsOpen]);

  // Handle mouse move anywhere on the overlay
  const handleMouseMove = useCallback(() => {
    setIsVisible(true);
    startIdleTimeout();
  }, [startIdleTimeout]);

  // Handle mouse leaving the player area (200ms quick hide)
  const handleMouseLeave = useCallback(() => {
    clearHideTimeout();
    if (isPlaying && !isSettingsOpen) {
      hideTimeoutRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 200);
    }
  }, [isPlaying, clearHideTimeout, isSettingsOpen]);

  // Handle mouse entering the player area
  const handleMouseEnter = useCallback(() => {
    clearHideTimeout();
    setIsVisible(true);
    startIdleTimeout();
  }, [clearHideTimeout, startIdleTimeout]);

  // Handle controls specific hover
  const handleControlsEnter = useCallback(() => {
    isHoveringControlsRef.current = true;
    startIdleTimeout();
  }, [startIdleTimeout]);

  const handleControlsLeave = useCallback(() => {
    isHoveringControlsRef.current = false;
    startIdleTimeout();
  }, [startIdleTimeout]);

  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setIsSettingsOpen(open);
      if (open) {
        clearHideTimeout();
        setIsVisible(true);
      } else {
        startIdleTimeout();
      }
    },
    [clearHideTimeout, startIdleTimeout]
  );

  // Reset when playing state changes
  useEffect(() => {
    if (!isPlaying) {
      clearHideTimeout();
      setIsVisible(true);
    } else {
      startIdleTimeout();
    }
  }, [isPlaying, clearHideTimeout, startIdleTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearHideTimeout();
  }, [clearHideTimeout]);

  return (
    /* Parent Overlay - Handles Mouse Tracking & Video Clicks */
    <div
      ref={containerRef}
      className={`absolute inset-0 z-30 flex flex-col justify-end ${isVisible || !isPlaying ? "cursor-default" : "cursor-none"}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={onToggleFullscreen}
    >
      {/* Controls bar at the bottom */}
      <div
        className={`
                    w-full bg-gradient-to-t from-black/90 to-transparent pt-20 pb-4 px-4
                    transition-opacity duration-200 ease-in-out pointer-events-none z-40
                    ${isVisible || !isPlaying ? "opacity-100" : "opacity-0"}
                `}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {/* Progress Bar - Twitch Purple */}
        <div
          className="w-full mb-2 pointer-events-auto"
          onMouseEnter={handleControlsEnter}
          onMouseLeave={handleControlsLeave}
        >
          <TwitchProgressBar
            currentTime={0}
            duration={0}
            onSeek={onSeek || (() => {})}
            isLive={true}
          />
        </div>

        <div
          className="flex items-center justify-between w-full pointer-events-auto"
          onMouseEnter={handleControlsEnter}
          onMouseLeave={handleControlsLeave}
        >
          <div className="flex items-center gap-2">
            <PlayPauseButton isPlaying={isPlaying} isLoading={isLoading} onToggle={onTogglePlay} />

            <VolumeControl
              volume={volume}
              muted={muted}
              onVolumeChange={onVolumeChange}
              onMuteToggle={onToggleMute}
            />

            {/* Live Badge */}
            <div className="flex items-center gap-1.5 px-2 py-1 bg-red-600 rounded text-xs font-bold uppercase tracking-wider text-white ml-2 select-none">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
              Live
            </div>

            {/* AdBlock Status */}
            {adBlockStatus?.isActive && (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`
                                            ${adBlockStatus.isShowingAd ? "text-green-500 animate-pulse hover:text-green-400 hover:bg-green-500/10" : "text-white/70 hover:text-white hover:bg-white/20"}
                                            cursor-help ml-1
                                        `}
                  >
                    <LuShieldCheck className="w-6 h-6" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent container={containerRef.current}>
                  <p>{adBlockStatus.isShowingAd ? "Blocking Ads..." : "Ad-Block Active"}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <div className="flex items-center gap-2">
            <SettingsMenu
              qualities={qualities}
              currentQualityId={currentQualityId}
              onQualityChange={onQualityChange}
              onTogglePip={onTogglePip}
              onToggleTheater={onToggleTheater}
              isTheater={isTheater}
              onOpenChange={handleSettingsOpenChange}
              showVideoStats={showVideoStats}
              onToggleVideoStats={onToggleVideoStats}
              container={containerRef.current}
            />

            {controls.showTheater && onToggleTheater && !isFullscreen && (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/20 cursor-pointer"
                    onClick={onToggleTheater}
                  >
                    {isTheater ? (
                      <TheaterFilledIcon className="w-6 h-6" />
                    ) : (
                      <TheaterOutlineIcon className="w-6 h-6" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent container={containerRef.current}>
                  <p>{isTheater ? "Exit Theater Mode (t)" : "Theater Mode (t)"}</p>
                </TooltipContent>
              </Tooltip>
            )}

            {controls.showFullscreen && (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/20 cursor-pointer"
                    onClick={onToggleFullscreen}
                  >
                    {isFullscreen ? (
                      <LuMinimize className="w-6 h-6" strokeWidth={3} />
                    ) : (
                      <LuMaximize className="w-6 h-6" strokeWidth={3} />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent container={containerRef.current}>
                  <p>{isFullscreen ? "Exit Fullscreen (f)" : "Fullscreen (f)"}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
