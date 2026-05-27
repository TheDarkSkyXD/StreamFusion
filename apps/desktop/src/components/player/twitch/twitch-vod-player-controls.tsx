import { useEffect, useState } from "react";
import { useManagedTimeout } from "@/hooks/useManagedTimeout";
import { LuMaximize, LuMinimize, LuMonitor } from "react-icons/lu";

import { formatDuration } from "@/lib/utils";
import { DEFAULT_PLAYER_CONTROLS_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";

import { Button } from "../../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip";
import { PlayPauseButton } from "../play-pause-button";
import { SettingsMenu } from "../settings-menu";
import type { QualityLevel } from "../types";
import { VolumeControl } from "../volume-control";

import { TwitchProgressBar } from "./twitch-progress-bar";

interface TwitchVodPlayerControlsProps {
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
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  buffered?: TimeRanges;

  // Playback Speed
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;

  // Seek Preview
  onSeekHover?: (time: number | null) => void;
  previewImage?: string;
}

export function TwitchVodPlayerControls(props: TwitchVodPlayerControlsProps) {
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
    currentTime,
    duration,
    onSeek,
    buffered,
    playbackRate,
    onPlaybackRateChange,
    onSeekHover,
    previewImage,
  } = props;

  const controls =
    useAuthStore((s) => s.preferences?.playerControls) ?? DEFAULT_PLAYER_CONTROLS_PREFERENCES;

  const [isVisible, setIsVisible] = useState(true);

  // Twitch purple color
  const twitchPurple = "#9146ff";

  const hideTimer = useManagedTimeout(() => setIsVisible(false));

  // Auto-hide controls logic
  useEffect(() => {
    setIsVisible(true);
    if (isPlaying) {
      hideTimer.start(3000);
    } else {
      hideTimer.clear();
    }
  }, [isPlaying, hideTimer]);

  return (
    <div
      className={`
            absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-black/90 to-transparent pt-20 pb-4 px-4
            transition-opacity duration-300 ease-in-out
            ${isVisible || !isPlaying ? "opacity-100" : "opacity-0"}
        `}
      onMouseEnter={() => {
        hideTimer.clear();
        setIsVisible(true);
      }}
      onMouseLeave={() => {
        if (isPlaying) {
          hideTimer.start(2000);
        }
      }}
    >
      {/* VOD Progress Bar - Twitch Purple */}
      <div className="w-full mb-2">
        <TwitchProgressBar
          currentTime={currentTime}
          duration={duration}
          onSeek={onSeek}
          buffered={buffered}
          onSeekHover={onSeekHover}
          previewImage={previewImage}
        />
      </div>

      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <PlayPauseButton isPlaying={isPlaying} isLoading={isLoading} onToggle={onTogglePlay} />

          <VolumeControl
            volume={volume}
            muted={muted}
            onVolumeChange={onVolumeChange}
            onMuteToggle={onToggleMute}
          />

          {/* Timestamp */}
          <div className="text-white text-2xl font-bold ml-2 select-none">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </div>
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
          />

          {controls.showTheater && onToggleTheater && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`text-white hover:bg-white/20`}
                  onClick={onToggleTheater}
                  style={isTheater ? { color: twitchPurple } : undefined}
                >
                  <LuMonitor className="w-6 h-6" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Theater Mode (t)</p>
              </TooltipContent>
            </Tooltip>
          )}

          {controls.showFullscreen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-white hover:bg-white/20"
                  onClick={onToggleFullscreen}
                >
                  {isFullscreen ? (
                    <LuMinimize className="w-6 h-6" strokeWidth={3} />
                  ) : (
                    <LuMaximize className="w-6 h-6" strokeWidth={3} />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{isFullscreen ? "Exit Fullscreen (f)" : "Fullscreen (f)"}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
