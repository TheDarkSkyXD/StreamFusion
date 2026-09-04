export interface QualityLevel {
  id: string;
  label: string; // "1080p60", "720p", "480p", etc.
  width: number;
  height: number;
  bitrate: number;
  frameRate?: number;
  isAuto?: boolean;
  isSource?: boolean;
  name?: string;
}

// Standardized error codes for player error handling
export type PlayerErrorCode =
  | "STREAM_OFFLINE" // Stream is offline or unavailable
  | "PROXY_ERROR" // Proxy server error (500, etc.)
  | "TOKEN_EXPIRED" // Playback token has expired
  | "NO_FRAGMENTS" // No video fragments received after manifest load
  | "MEDIA_ERROR" // Fatal media/decoding error
  | "HLS_FATAL" // Unrecoverable HLS error
  | "NATIVE_ERROR" // Native playback error (Safari HLS)
  | "PLAYBACK_ERROR"; // Generic playback failure

export interface PlayerError {
  code: PlayerErrorCode | string;
  message: string;
  fatal: boolean;
  originalError?: unknown;
  /** If true, caller should attempt to refresh playback URL */
  shouldRefresh?: boolean;
}

export interface StreamPlayback {
  url: string;
  format: "hls" | "dash" | "mp4";
  qualities?: {
    quality: string;
    url: string;
    frameRate?: number;
  }[];
}

export interface TimedTextTrack {
  key: string;
  hlsTrackId: number | null;
  cueTrack: string;
  kind: "subtitles" | "captions";
  label: string;
  language: string;
}

export interface TimedTextCue {
  text: string;
  startTime: number;
  endTime: number;
  align?: "start" | "center" | "end" | "left" | "right";
  line?: number | "auto";
  lineAlign?: "start" | "center" | "end";
  position?: number | "auto";
  positionAlign?: "line-left" | "center" | "line-right" | "auto";
  size?: number;
  snapToLines?: boolean;
  localLive?: {
    cueId: string;
    revision: number;
    isFinal: boolean;
    words: Array<{ text: string; startTime: number; endTime: number }>;
    wordTimingValid: boolean;
    activeWordIndex: number | null;
    fallbackHighlight: boolean;
  };
}

export interface TimedTextError {
  failedTrackKey: string;
  message: string;
}

const LOCAL_LIVE_CAPTION_TRACK_LABEL = "Local live captions (English)";

export const LOCAL_LIVE_CAPTION_TRACK: TimedTextTrack = {
  key: "local-live:en",
  hlsTrackId: null,
  cueTrack: "local-live",
  kind: "captions",
  label: LOCAL_LIVE_CAPTION_TRACK_LABEL,
  language: "en",
};
