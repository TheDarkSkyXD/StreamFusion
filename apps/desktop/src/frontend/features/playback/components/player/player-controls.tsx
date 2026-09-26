import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuMaximize, LuMinimize, LuRotateCcw, LuRotateCw } from "react-icons/lu";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { formatDuration } from "@/lib/utils";
import { DEFAULT_PLAYER_CONTROLS_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/features/auth/components/state/auth-store";

import { Button } from "../../../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";

import { PlayPauseButton } from "./play-pause-button";
import { ProgressBar } from "./progress-bar";
import { SettingsMenu, type SettingsMenuProps } from "./settings-menu";
import type { QualityLevel } from "../../capabilities/media-types";
import { VolumeControl } from "./volume-control";

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

function isValidSeekInterval(seconds: number | undefined): seconds is number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0;
}

export interface PlayerControlsProps extends Pick<
  SettingsMenuProps,
  | "timedTextTracks"
  | "localTimedTextTrack"
  | "currentTimedTextTrackKey"
  | "onTimedTextTrackChange"
  | "localCaptionModel"
  | "localCaptionPhase"
  | "localCaptionError"
  | "onLocalCaptionModelDownload"
  | "onLocalCaptionModelCancel"
  | "onLocalCaptionModelRemove"
  | "onLocalCaptionRetry"
> {
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
  // VOD specific
  currentTime?: number;
  duration?: number;
  onSeek?: (time: number) => void;
  seekBackwardSeconds?: number;
  seekForwardSeconds?: number;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
  seekBackwardDisabled?: boolean;
  seekForwardDisabled?: boolean;
  onSeekHover?: (time: number | null) => void;
  previewImage?: string;
  buffered?: TimeRanges;

  // Playback Speed
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;

  progressBar?: ReactNode;
  leftAddon?: ReactNode;
  liveBadge?: ReactNode;
  rightAddon?: ReactNode;
  showVideoStats?: boolean;
  onToggleVideoStats?: () => void;
  theaterActiveColor?: string;
}

export function PlayerControls(props: PlayerControlsProps) {
  const { t } = useTranslation();
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
    seekBackwardSeconds,
    seekForwardSeconds,
    onSeekBackward,
    onSeekForward,
    seekBackwardDisabled,
    seekForwardDisabled,
    buffered,
    playbackRate,
    onPlaybackRateChange,
    progressBar,
    leftAddon,
    liveBadge,
    rightAddon,
    showVideoStats,
    onToggleVideoStats,
    theaterActiveColor,
  } = props;

  const controls =
    useAuthStore((s) => s.preferences?.playerControls) ?? DEFAULT_PLAYER_CONTROLS_PREFERENCES;

  const [isVisible, setIsVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPointerInsideRef = useRef(false);
  const lastInputWasTouchRef = useRef(false);
  const isHoveringControlsRef = useRef(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isLive = !duration || duration === Infinity;

  const hideTimer = useManagedTimeout(() => setIsVisible(false));

  // Start idle timeout
  const startIdleTimeout = useCallback(() => {
    if (!isLive && isPointerInsideRef.current && !lastInputWasTouchRef.current) {
      hideTimer.clear();
      return;
    }
    if (isPlaying && !isSettingsOpen) {
      hideTimer.start(
        lastInputWasTouchRef.current ? 4000 : isHoveringControlsRef.current ? 3000 : 1000
      );
    } else {
      hideTimer.clear();
    }
  }, [isLive, isPlaying, isSettingsOpen, hideTimer]);

  // Handle mouse move anywhere on the overlay
  const handleMouseMove = useCallback(() => {
    setIsVisible(true);
    startIdleTimeout();
  }, [startIdleTimeout]);

  // Handle mouse leaving the player area (200ms quick hide)
  const handleMouseLeave = useCallback(() => {
    if (lastInputWasTouchRef.current) return;
    isPointerInsideRef.current = false;
    if (isPlaying && !isSettingsOpen) {
      hideTimer.start(200);
    } else {
      hideTimer.clear();
    }
  }, [isPlaying, isSettingsOpen, hideTimer]);

  // Handle mouse entering the player area
  const handleMouseEnter = useCallback(() => {
    isPointerInsideRef.current = true;
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

  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setIsSettingsOpen(open);
      if (open) {
        hideTimer.clear();
        setIsVisible(true);
      } else {
        startIdleTimeout();
      }
    },
    [hideTimer, startIdleTimeout]
  );

  const handleOverlayDoubleClick = useCallback(() => {
    onToggleFullscreen();
  }, [onToggleFullscreen]);

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
      onPointerDown={(event) => {
        lastInputWasTouchRef.current = event.pointerType === "touch";
        if (!lastInputWasTouchRef.current) return;
        setIsVisible(true);
        startIdleTimeout();
      }}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") lastInputWasTouchRef.current = false;
      }}
      onDoubleClick={handleOverlayDoubleClick}
    >
      {/* Controls bar at the bottom */}
      <div
        className={`
                w-full bg-gradient-to-t from-black/90 to-transparent px-2 pb-2 pt-8 sm:px-4 sm:pb-4 sm:pt-20
                transition-opacity duration-200 ease-in-out pointer-events-none z-40
                ${isVisible || !isPlaying ? "opacity-100" : "opacity-0"}
            `}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {/* VOD Progress Bar */}
        {(progressBar || (!isLive && onSeek)) && (
          <div
            className="mb-1 w-full px-1 pointer-events-auto sm:mb-2 sm:px-4"
            onMouseEnter={handleControlsEnter}
            onMouseLeave={handleControlsLeave}
          >
            {progressBar ?? (
              <ProgressBar
                currentTime={currentTime}
                duration={duration}
                onSeek={onSeek ?? (() => {})}
                onSeekHover={props.onSeekHover}
                previewImage={props.previewImage}
                buffered={buffered}
              />
            )}
          </div>
        )}

        <div
          className={`flex w-full flex-wrap items-center justify-between gap-y-1 pointer-events-auto sm:flex-nowrap ${isFullscreen ? "" : "max-w-screen-2xl mx-auto"}`}
          onMouseEnter={handleControlsEnter}
          onMouseLeave={handleControlsLeave}
        >
          <div className="flex min-w-0 items-center gap-1 sm:gap-2">
            {onSeekBackward && isValidSeekInterval(seekBackwardSeconds) && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("playback.rewindSeconds", { seconds: seekBackwardSeconds })}
                className="relative cursor-pointer rounded-full text-white hover:bg-white/20 max-lg:min-h-11 max-lg:min-w-11"
                onClick={onSeekBackward}
                disabled={seekBackwardDisabled}
              >
                <LuRotateCcw aria-hidden className="w-7 h-7" />
                <span className="absolute text-[10px] font-bold leading-none">
                  {seekBackwardSeconds}
                </span>
              </Button>
            )}

            <PlayPauseButton
              isPlaying={isPlaying}
              isLoading={isLoading}
              onToggle={onTogglePlay}
              className="max-lg:min-h-11 max-lg:min-w-11"
            />

            {onSeekForward && isValidSeekInterval(seekForwardSeconds) && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("playback.fastForwardSeconds", { seconds: seekForwardSeconds })}
                className="relative cursor-pointer rounded-full text-white hover:bg-white/20 max-lg:min-h-11 max-lg:min-w-11"
                onClick={onSeekForward}
                disabled={seekForwardDisabled}
              >
                <LuRotateCw aria-hidden className="w-7 h-7" />
                <span className="absolute text-[10px] font-bold leading-none">
                  {seekForwardSeconds}
                </span>
              </Button>
            )}

            <div className="max-lg:[&_button]:min-h-11 max-lg:[&_button]:min-w-11">
              <VolumeControl
                volume={volume}
                muted={muted}
                onVolumeChange={onVolumeChange}
                onMuteToggle={onToggleMute}
              />
            </div>

            {/* Live Badge or Timestamp */}
            {isLive ? (
              (liveBadge ?? (
                <div className="flex items-center gap-1.5 px-2 py-1 bg-red-600 rounded text-xs font-bold uppercase tracking-wider text-white ml-2 select-none">
                  <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                  {t("playback.live2")}
                </div>
              ))
            ) : (
              <div className="ml-1 select-none whitespace-nowrap text-xs font-bold text-white sm:ml-2 sm:text-2xl">
                {formatDuration(currentTime)} / {formatDuration(duration)}
              </div>
            )}

            {leftAddon}
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {rightAddon}

            <div className="max-lg:[&_button]:min-h-11 max-lg:[&_button]:min-w-11">
              <SettingsMenu
                qualities={qualities}
                currentQualityId={currentQualityId}
                onQualityChange={onQualityChange}
                onTogglePip={onTogglePip}
                onToggleTheater={onToggleTheater}
                isTheater={isTheater}
                playbackRate={playbackRate}
                onPlaybackRateChange={isLive ? undefined : onPlaybackRateChange}
                onOpenChange={handleSettingsOpenChange}
                showVideoStats={showVideoStats}
                onToggleVideoStats={onToggleVideoStats}
                container={containerRef.current}
                timedTextTracks={props.timedTextTracks}
                localTimedTextTrack={props.localTimedTextTrack}
                currentTimedTextTrackKey={props.currentTimedTextTrackKey}
                onTimedTextTrackChange={props.onTimedTextTrackChange}
                localCaptionModel={props.localCaptionModel}
                localCaptionPhase={props.localCaptionPhase}
                localCaptionError={props.localCaptionError}
                onLocalCaptionModelDownload={props.onLocalCaptionModelDownload}
                onLocalCaptionModelCancel={props.onLocalCaptionModelCancel}
                onLocalCaptionModelRemove={props.onLocalCaptionModelRemove}
                onLocalCaptionRetry={props.onLocalCaptionRetry}
              />
            </div>

            {controls.showTheater && onToggleTheater && !isFullscreen && (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="cursor-pointer text-white hover:bg-white/20 max-lg:min-h-11 max-lg:min-w-11"
                    onClick={onToggleTheater}
                    aria-label={
                      isTheater ? t("playback.exitTheaterModeT") : t("playback.theaterModeT")
                    }
                    style={
                      isTheater && theaterActiveColor ? { color: theaterActiveColor } : undefined
                    }
                  >
                    {isTheater ? (
                      <TheaterFilledIcon className="w-6 h-6" />
                    ) : (
                      <TheaterOutlineIcon className="w-6 h-6" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent container={containerRef.current}>
                  <p>{isTheater ? t("playback.exitTheaterModeT") : t("playback.theaterModeT")}</p>
                </TooltipContent>
              </Tooltip>
            )}

            {controls.showFullscreen && (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="cursor-pointer text-white hover:bg-white/20 max-lg:min-h-11 max-lg:min-w-11"
                    onClick={onToggleFullscreen}
                    aria-label={
                      isFullscreen ? t("playback.exitFullscreenF") : t("playback.fullscreenF")
                    }
                  >
                    {isFullscreen ? (
                      <LuMinimize className="w-6 h-6" strokeWidth={3} />
                    ) : (
                      <LuMaximize className="w-6 h-6" strokeWidth={3} />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent container={containerRef.current}>
                  <p>{isFullscreen ? t("playback.exitFullscreenF") : t("playback.fullscreenF")}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
