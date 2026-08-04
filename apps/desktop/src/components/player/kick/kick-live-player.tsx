import type Hls from "hls.js";
import type React from "react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useRenderCount } from "@/components/dev/use-render-count";
import { KickLoadingSpinner } from "@/components/ui/loading-spinner";
import { logger } from "@/renderer/logging/logger";

import { useDefaultQuality } from "../hooks/use-default-quality";
import { useDockedPlayerConfig } from "../persistent-player-shell";
import { qualityLevelToPreference } from "../quality-preference";
import { useFullscreen } from "../hooks/use-fullscreen";
import { useLocalLiveCaptions } from "../hooks/use-local-live-captions";
import { usePictureInPicture } from "../hooks/use-picture-in-picture";
import { usePlayerKeyboard } from "../hooks/use-player-keyboard";
import { usePlayerNetworkRecovery } from "../hooks/use-player-network-recovery";
import { useResumePlayback } from "../hooks/use-resume-playback";
import { useTimedText } from "../hooks/use-timed-text";
import { useVolume } from "../hooks/use-volume";
import { CaptionOverlay } from "../caption-overlay";
import {
  LOCAL_LIVE_CAPTION_TRACK,
  type Platform,
  type PlayerError,
  type QualityLevel,
} from "../types";

import { KickHlsPlayer } from "./kick-hls-player";
import { KickLivePlayerControls } from "./kick-live-player-controls";
import type { KickProgressBarHandle } from "./kick-progress-bar";
import { UptimeReadout } from "./uptime-readout";

export interface KickLivePlayerProps {
  streamUrl: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  quality?: QualityLevel;
  onReady?: () => void;
  onError?: (error: PlayerError) => void;
  onQualityChange?: (quality: QualityLevel) => void;
  className?: string;
  isTheater?: boolean;
  onToggleTheater?: () => void;
  // Stream identification for resume playback
  channelName?: string;
  title?: string;
  thumbnail?: string;
  startedAt?: string | null; // Stream start time for uptime calculation, or null if unknown
  // Optional manual refresh callback retained for page-level compatibility.
  onRefresh?: () => void;
  compact?: boolean;
}

const NO_QUALITY_LEVELS: QualityLevel[] = [];
const ignoreQualityChange = () => {};

export const KickLivePlayer = forwardRef<HTMLVideoElement, KickLivePlayerProps>(
  function KickLivePlayer(props, forwardedVideoRef) {
    useRenderCount("KickLivePlayer");
    const {
      streamUrl,
      poster,
      autoPlay = false,
      muted: initialMuted = false,
      quality,
      onReady,
      onError,
      onQualityChange,
      className,
      isTheater,
      onToggleTheater,
      channelName,
      title,
      thumbnail,
      startedAt,
      compact = false,
    } = props;
    const isDockedChannelSurface = useDockedPlayerConfig() !== null;
    const shouldApplySavedQuality = isDockedChannelSurface;

    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const [hls, setHls] = useState<Hls | null>(null);
    const progressBarRef = useRef<KickProgressBarHandle>(null);
    // Mirrors the most recent currentTime value computed by `UptimeReadout` so
    // `handleSeek` can read fresh state without depending on it for re-renders.
    const currentTimeRef = useRef(0);
    useImperativeHandle(forwardedVideoRef, () => videoRef.current as HTMLVideoElement);

    // Persistent volume
    const { volume, isMuted, handleVolumeChange, handleToggleMute, syncFromVideoElement } =
      useVolume({
        videoRef: videoRef as React.RefObject<HTMLVideoElement>,
        initialMuted,
        watch: `${streamUrl}-${initialMuted}`, // Reset when either changes
        forcedMuted: initialMuted,
      });
    const timedText = useTimedText(hls, streamUrl, videoRef.current);
    const localCaptions = useLocalLiveCaptions({
      videoRef,
      sessionId: streamUrl,
      sourceKey: streamUrl,
      muted: isMuted,
      volume,
    });

    // Hooks
    const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);
    const { isPip, togglePip } = usePictureInPicture(videoRef);

    // Resume playback hook (for live streams with DVR)
    useResumePlayback({
      platform: "kick" as Platform,
      videoId: channelName ? `live-${channelName}` : "",
      videoRef: videoRef as React.RefObject<HTMLVideoElement>,
      title: title || channelName,
      thumbnail,
      enabled: false, // Disabled: Always start at live edge (no DVR support)
    });

    // State
    const [isReady, setIsReady] = useState(false);
    const [isPlaying, setIsPlaying] = useState(autoPlay);
    const [availableQualities, setAvailableQualities] = useState<QualityLevel[]>([]);
    const [activeQualityId, setActiveQualityId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [hasError, setHasError] = useState(false);
    const [networkRecoveryRevision, setNetworkRecoveryRevision] = useState(0);
    const recoverFromNetworkError = useCallback(() => {
      setHasError(false);
      setIsLoading(true);
      setIsReady(false);
      setNetworkRecoveryRevision((revision) => revision + 1);
    }, []);
    usePlayerNetworkRecovery(hasError, recoverFromNetworkError);

    const defaultQualityResult = useDefaultQuality(NO_QUALITY_LEVELS, "auto", ignoreQualityChange);
    const defaultQuality = defaultQualityResult?.defaultQuality ?? "auto";

    const qualitySessionKey = channelName || streamUrl;
    const [qualityPreference, setQualityPreference] = useState<string | null>(() =>
      shouldApplySavedQuality ? String(defaultQuality) : null
    );
    const qualitySessionKeyRef = useRef(qualitySessionKey);
    const hasSeededSavedQualityRef = useRef(shouldApplySavedQuality);
    useEffect(() => {
      if (qualitySessionKeyRef.current !== qualitySessionKey) {
        qualitySessionKeyRef.current = qualitySessionKey;
        hasSeededSavedQualityRef.current = shouldApplySavedQuality;
        setQualityPreference(shouldApplySavedQuality ? String(defaultQuality) : null);
        setActiveQualityId(null);
        return;
      }

      if (shouldApplySavedQuality && !hasSeededSavedQualityRef.current) {
        hasSeededSavedQualityRef.current = true;
        setQualityPreference(String(defaultQuality));
      }
    }, [defaultQuality, qualitySessionKey, shouldApplySavedQuality]);

    // Reset error/ready state on mount (original effect)
    useEffect(() => {
      setHasError(false);
      setIsReady(false);
    }, []);

    // Resume playback if Chromium auto-paused the video when the window was minimized
    useEffect(() => {
      let wasPlaying = false;

      const handleVisibilityChange = () => {
        const video = videoRef.current;
        if (!video) return;

        if (document.hidden) {
          wasPlaying = !video.paused;
        } else if (wasPlaying) {
          video.play().catch((e) => {
            if (e.name !== "AbortError" && e.name !== "NotAllowedError") {
              logger.error("Player:Kick:Live", "failed to resume after window restore", {
                error: e,
              });
            }
          });
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }, []);

    // Setup event listeners (play/pause/loading/playbackRate). Time updates are
    // handled by `UptimeReadout` writing directly to the progress bar's DOM.
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      const handlePlay = () => setIsPlaying(true);
      const handlePause = () => setIsPlaying(false);
      const handleVideoVolumeChange = () => {
        syncFromVideoElement();
      };
      const handleWait = () => setIsLoading(true);
      const handlePlaying = () => setIsLoading(false);
      const handleRateChange = () => setPlaybackRate(video.playbackRate);

      video.addEventListener("play", handlePlay);
      video.addEventListener("pause", handlePause);
      video.addEventListener("volumechange", handleVideoVolumeChange);
      video.addEventListener("waiting", handleWait);
      video.addEventListener("playing", handlePlaying);
      video.addEventListener("ratechange", handleRateChange);

      return () => {
        video.removeEventListener("play", handlePlay);
        video.removeEventListener("pause", handlePause);
        video.removeEventListener("volumechange", handleVideoVolumeChange);
        video.removeEventListener("waiting", handleWait);
        video.removeEventListener("playing", handlePlaying);
        video.removeEventListener("ratechange", handleRateChange);
      };
    }, [syncFromVideoElement]);

    // Volume initialization is handled by useVolume hook

    // Handlers
    const togglePlay = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        // For live streams: seek to live edge before playing
        // This ensures we're watching "live" when resuming playback
        if (video.seekable.length > 0) {
          const liveEdge = video.seekable.end(video.seekable.length - 1);
          video.currentTime = liveEdge;
        }
        video.play().catch((e) => {
          // Ignore AbortError (interrupted by load) and NotAllowedError (autoplay policy)
          if (e.name !== "AbortError" && e.name !== "NotAllowedError") {
            logger.error("Player:Kick:Live", "play error", { error: e });
          }
        });
      } else {
        video.pause();
      }
    }, []);

    const toggleMute = handleToggleMute;

    const togglePipHandler = useCallback(async () => {
      await togglePip();
    }, [togglePip]);

    const handleSeek = useCallback(
      (targetTime: number) => {
        const video = videoRef.current;
        if (!video) return;

        if (startedAt) {
          // Delta Seeking: Calculate difference from current UI time
          // usage: targetTime is "seconds since stream start"
          // currentTimeRef tracks the latest UI time written by UptimeReadout
          let currentStreamTime = currentTimeRef.current;

          // If we have HLS playingDate, use it for base truth
          if (hlsRef.current?.playingDate) {
            const start = new Date(startedAt).getTime();
            currentStreamTime = (hlsRef.current.playingDate.getTime() - start) / 1000;
          } else if (video.seekable.length > 0) {
            // Fallback calculations
            const now = Date.now();
            const start = new Date(startedAt).getTime();
            const uptime = (now - start) / 1000;
            const seekableEnd = video.seekable.end(video.seekable.length - 1);
            const secondsFromLive = seekableEnd - video.currentTime;
            currentStreamTime = uptime - secondsFromLive;
          }

          const diff = targetTime - currentStreamTime;
          let newTime = video.currentTime + diff;

          // Clamp to seekable, but allow a bit of buffer
          if (video.seekable.length > 0) {
            const start = video.seekable.start(0);
            const end = video.seekable.end(video.seekable.length - 1);

            if (newTime < start) {
              newTime = start;
            }
            if (newTime > end) {
              newTime = end;
            }
          }

          video.currentTime = newTime;
        } else {
          video.currentTime = targetTime;
        }
      },
      [startedAt]
    );

    const handlePlaybackRateChange = useCallback((rate: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.playbackRate = rate;
    }, []);

    const handleQualityLevels = useCallback(
      (levels: QualityLevel[]) => {
        setAvailableQualities(levels);
        setActiveQualityId(null);
        if (!isReady) {
          setIsReady(true);
          // Only stop loading immediately if we are NOT auto-playing
          // If auto-playing, wait for the actual 'playing' event to clear the spinner
          if (!autoPlay) {
            setIsLoading(false);
          }
          onReady?.();
        }
      },
      [isReady, onReady, autoPlay]
    );

    const handleQualitySet = useCallback(
      (id: string) => {
        const level = availableQualities.find((qualityLevel) => qualityLevel.id === id);
        if (!level) return;
        setQualityPreference(qualityLevelToPreference(level));
        const hls = hlsRef.current;
        if (hls) {
          if (id === "auto") {
            hls.currentLevel = -1;
          } else {
            const levelIndex = Number.parseInt(id, 10);
            if (!Number.isNaN(levelIndex) && levelIndex >= 0 && levelIndex < hls.levels.length) {
              hls.currentLevel = levelIndex;
            }
          }
        }
        if (onQualityChange) {
          onQualityChange(level);
        }
      },
      [availableQualities, onQualityChange]
    );

    const handleHlsInstance = useCallback((hls: Hls) => {
      hlsRef.current = hls;
      setHls(hls);
    }, []);

    const handleTimedTextTrackChange = useCallback(
      (trackKey: string | null) => {
        if (trackKey === LOCAL_LIVE_CAPTION_TRACK.key) {
          void localCaptions.selectLocal();
          return;
        }
        void localCaptions.stop();
        timedText.selectTrack(trackKey);
      },
      [localCaptions, timedText]
    );
    const currentTimedTextTrackKey = localCaptions.selected
      ? LOCAL_LIVE_CAPTION_TRACK.key
      : timedText.selectedTrackKey;

    // Keyboard shortcuts
    usePlayerKeyboard({
      onTogglePlay: togglePlay,
      onToggleMute: toggleMute,
      onVolumeUp: () => handleVolumeChange((v) => v + 10),
      onVolumeDown: () => handleVolumeChange((v) => v - 10),
      onToggleFullscreen: toggleFullscreen,
      disabled: !isReady,
    });

    return (
      <div
        ref={containerRef}
        className={`relative w-full h-full bg-black overflow-hidden group flex flex-col justify-center ${className || ""}`}
      >
        {streamUrl ? (
          <KickHlsPlayer
            key={networkRecoveryRevision}
            ref={videoRef}
            src={streamUrl}
            isLive
            poster={poster}
            muted={isMuted}
            autoPlay={autoPlay}
            preferredQuality={
              shouldApplySavedQuality && !compact ? (qualityPreference ?? undefined) : undefined
            }
            onQualityLevels={handleQualityLevels}
            onActiveQualityChange={setActiveQualityId}
            onError={(error) => {
              logger.error("Player:Kick:Live", "player error", { error });
              setHasError(true);
              setIsLoading(false);
              onError?.(error);
            }}
            onHlsInstance={handleHlsInstance}
            className="size-full object-contain object-center cursor-pointer"
            controls={false}
            onDoubleClick={toggleFullscreen}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white z-0">
            <p>No Stream Source</p>
          </div>
        )}

        {/* Centered Loading Spinner - Kick Green */}
        {isLoading && streamUrl && (
          <div className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none">
            <KickLoadingSpinner />
          </div>
        )}

        <CaptionOverlay cues={[...timedText.activeCues, ...localCaptions.activeCues]} />

        {/* Drives the 1Hz uptime tick without re-rendering the player tree. */}
        <UptimeReadout
          startedAt={startedAt}
          isPlaying={isPlaying}
          videoRef={videoRef}
          hlsRef={hlsRef}
          progressBarRef={progressBarRef}
          currentTimeRef={currentTimeRef}
        />

        {/* Controls Overlay - Live stream with DVR progress bar */}
        {streamUrl && !hasError && !compact && (
          <KickLivePlayerControls
            isPlaying={isPlaying}
            isLoading={isLoading}
            volume={volume}
            muted={isMuted}
            qualities={availableQualities}
            currentQualityId={activeQualityId ?? "auto"}
            isFullscreen={isFullscreen}
            onTogglePlay={togglePlay}
            onToggleMute={toggleMute}
            onVolumeChange={handleVolumeChange}
            onQualityChange={handleQualitySet}
            onToggleFullscreen={toggleFullscreen}
            onToggleTheater={onToggleTheater}
            isTheater={isTheater}
            onTogglePip={togglePipHandler}
            onSeek={handleSeek}
            progressBarRef={progressBarRef}
            playbackRate={playbackRate}
            onPlaybackRateChange={handlePlaybackRateChange}
            timedTextTracks={timedText.tracks}
            localTimedTextTrack={LOCAL_LIVE_CAPTION_TRACK}
            currentTimedTextTrackKey={currentTimedTextTrackKey}
            onTimedTextTrackChange={handleTimedTextTrackChange}
            localCaptionModel={localCaptions.modelState}
            localCaptionPhase={localCaptions.phase}
            localCaptionError={localCaptions.error}
            onLocalCaptionModelDownload={localCaptions.downloadModel}
            onLocalCaptionModelCancel={localCaptions.cancelModelDownload}
            onLocalCaptionModelRemove={localCaptions.removeModel}
            onLocalCaptionRetry={localCaptions.retry}
          />
        )}
      </div>
    );
  }
);
