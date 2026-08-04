export type StreamCaptionTrackKind = "captions" | "subtitles";

export type StreamCaptionProvenance = "broadcaster" | "platform";

export type StreamCaptionUnavailableReason = "not-provided" | "unsupported";

export interface StreamCaptionAvailable {
  status: "available";
}

export interface StreamCaptionUnavailable {
  status: "unavailable";
  reason: StreamCaptionUnavailableReason;
}

export interface StreamCaptionError {
  status: "error";
  retryable: boolean;
  message: string;
}

export type StreamCaptionAvailability =
  StreamCaptionAvailable | StreamCaptionUnavailable | StreamCaptionError;

export interface StreamCaptionSourceDescriptor {
  /** Stable logical identifier; never a manifest, playlist, or segment URL. */
  id: string;
  kind: StreamCaptionTrackKind;
  label: string;
  /** BCP-47 language tag, or null when the stream does not declare one. */
  language: string | null;
  provenance: StreamCaptionProvenance;
  availability: StreamCaptionAvailability;
}
