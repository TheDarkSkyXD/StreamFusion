import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuMaximize, LuMinimize, LuRadio } from "react-icons/lu";

import { useRenderCount } from "../../dev/use-render-count";
import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { PlayPauseButton } from "../play-pause-button";
import { SettingsMenu } from "../settings-menu";
import type { QualityLevel } from "../types";
import { VolumeControl } from "../volume-control";

import { KickProgressBar, type KickProgressBarHandle } from "./kick-progress-bar";

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

interface KickLivePlayerControlsProps {
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

  onSeek?: (time: number) => void;
  onGoLive?: () => void;
  /** Imperative handle the parent forwards to `UptimeReadout` for DOM updates. */
  progressBarRef?: React.Ref<KickProgressBarHandle>;

  // Playback Speed
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
}

export function KickLivePlayerControls(props: KickLivePlayerControlsProps) {
  useRenderCount("KickLivePlayerControls");
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
    onSeek,
    onGoLive,
    progressBarRef,
  } = props;

  const [isVisible, setIsVisible] = useState(true);
  const hideTimeoutRef = useRef<NodeJS.Timeout>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isHoveringControlsRef = useRef(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Kick brand green color
  const kickGreen = "#53fc18";

  // Check if we're at the live edge (within 10 seconds of duration)
  const isAtLiveEdge = true; // Forced Live State per user request (No DVR support)
  const isBehindLive = false;

  /* DISABLED - DVR SUPPORT BLOCKED
    const isAtLiveEdge = duration > 0 ? (duration - currentTime) < 10 : true;
    const isBehindLive = duration > 0 && !isAtLiveEdge;
    */

  // Handle go live click
  const handleGoLive = () => {
    if (onGoLive) {
      onGoLive();
    }
  };

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
        {/* DVR Progress Bar - Kick Green */}
        {onSeek && (
          <div
            className="w-full mb-2 pointer-events-auto"
            onMouseEnter={handleControlsEnter}
            onMouseLeave={handleControlsLeave}
          >
            <KickProgressBar
              ref={progressBarRef}
              onSeek={onSeek}
              isLive={isAtLiveEdge}
            />
          </div>
        )}

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

            {/* Show LIVE badge when at live edge */}
            {isAtLiveEdge && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/60 ml-2 select-none">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: kickGreen }} />
                <span className="text-white text-sm font-bold uppercase tracking-wider">LIVE</span>
              </div>
            )}

            {/* "Go Live" button — wired only if a future revival of DVR sets isBehindLive */}
            {isBehindLive && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-2 text-black font-bold text-xs uppercase tracking-wider px-3 py-1 rounded hover:opacity-90 cursor-pointer"
                style={{ backgroundColor: kickGreen }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleGoLive();
                }}
              >
                <LuRadio className="w-4 h-4 mr-1" />
                Go Live
              </Button>
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
              container={containerRef.current}
            />

            {onToggleTheater && !isFullscreen && (
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
          </div>
        </div>
      </div>
    </div>
  );
}
