import { useCallback, useEffect, useRef, useState } from "react";
import { LuMaximize, LuMinimize } from "react-icons/lu";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { formatDuration } from "@/lib/utils";

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

interface TwitchPlayerControlsProps {
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
  // VOD specific (not used for live streams)
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
  onSeekHover?: (time: number | null) => void;
  previewImage?: string;
  buffered?: TimeRanges;

  // Playback Speed
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;

  // Stats
  showVideoStats?: boolean;
  onToggleVideoStats?: () => void;
}

export function TwitchPlayerControls(props: TwitchPlayerControlsProps) {
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
    currentTime = 0,
    duration = 0,
    onSeek,
    buffered,
    playbackRate,
    onPlaybackRateChange,
    showVideoStats,
    onToggleVideoStats,
  } = props;

  const [isVisible, setIsVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const isHoveringControlsRef = useRef(false);

  const hideTimer = useManagedTimeout(() => setIsVisible(false));

  // Start idle timeout
  const startIdleTimeout = useCallback(() => {
    if (isPlaying) {
      hideTimer.start(isHoveringControlsRef.current ? 3000 : 1000);
    } else {
      hideTimer.clear();
    }
  }, [isPlaying, hideTimer]);

  // Handle mouse move anywhere on the overlay
  const handleMouseMove = useCallback(() => {
    setIsVisible(true);
    startIdleTimeout();
  }, [startIdleTimeout]);

  // Handle mouse leaving the player area (200ms quick hide)
  const handleMouseLeave = useCallback(() => {
    if (isPlaying) {
      hideTimer.start(200);
    } else {
      hideTimer.clear();
    }
  }, [isPlaying, hideTimer]);

  // Handle mouse entering the player area
  const handleMouseEnter = useCallback(() => {
    setIsVisible(true);
    startIdleTimeout();
  }, [startIdleTimeout]);

  // Handle controls specific hover
  const handleControlsEnter = useCallback(() => {
    isHoveringControlsRef.current = true;
    startIdleTimeout();
  }, [startIdleTimeout]);

  const handleControlsLeave = useCallback(() => {
    isHoveringControlsRef.current = false;
    startIdleTimeout();
  }, [startIdleTimeout]);

  // Reset when playing state changes
  useEffect(() => {
    if (!isPlaying) {
      hideTimer.clear();
      setIsVisible(true);
    } else {
      startIdleTimeout();
    }
  }, [isPlaying, hideTimer, startIdleTimeout]);

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
        {/* VOD Progress Bar - Only for videos, not live streams */}
        {duration > 0 && duration !== Infinity && onSeek && (
          <div
            className="w-full mb-2 pointer-events-auto"
            onMouseEnter={handleControlsEnter}
            onMouseLeave={handleControlsLeave}
          >
            <TwitchProgressBar
              currentTime={currentTime}
              duration={duration}
              onSeek={onSeek}
              onSeekHover={props.onSeekHover}
              previewImage={props.previewImage}
              buffered={buffered}
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

            {/* Live Badge or Timestamp */}
            {!duration || duration === Infinity ? (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-red-600 rounded text-xs font-bold uppercase tracking-wider text-white ml-2 select-none">
                <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                Live
              </div>
            ) : (
              <div className="text-white text-2xl font-bold ml-2 select-none">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </div>
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
              playbackRate={playbackRate}
              onPlaybackRateChange={onPlaybackRateChange}
              showVideoStats={showVideoStats}
              onToggleVideoStats={onToggleVideoStats}
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
                      <TheaterFilledIcon className="w-5 h-5" />
                    ) : (
                      <TheaterOutlineIcon className="w-5 h-5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
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
                    <LuMinimize className="w-5 h-5" strokeWidth={3} />
                  ) : (
                    <LuMaximize className="w-5 h-5" strokeWidth={3} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isFullscreen ? "Exit Fullscreen (f)" : "Fullscreen (f)"}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>
  );
}
