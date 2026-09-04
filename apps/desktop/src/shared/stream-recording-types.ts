import { Platform } from "@streamfusion/core/platform";

export type StreamRecordingStatus =
  "preparing" | "recording" | "paused" | "reconnecting" | "finalizing" | "interrupted";

export interface StreamRecordingGap {
  startedAt: string;
  endedAt?: string | null;
  reason: "paused" | "reconnect" | "restart";
}

export interface StreamRecordingSection {
  id: string;
  path: string;
  startedAt: string;
  endedAt?: string | null;
}

export interface StreamRecordingQuality {
  quality: string;
  url?: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  isSource?: boolean;
}

export interface StreamRecordingQualityChange {
  revision: number;
  fromQuality: string;
  toQuality: string;
}

export interface StreamRecordingArtifactIdentity {
  algorithm: "sha256";
  digest: string;
  size: number;
}

export type StreamRecordingRecoveryExhaustion =
  | {
      state: "finalizing";
      error: string;
    }
  | {
      state: "commit-intent";
      error: string;
      outputPath: string;
      outputFormat: "mp4" | "ts";
      usedFallback: boolean;
      artifactIdentity: StreamRecordingArtifactIdentity;
    }
  | {
      state: "pending-probe";
      error: string;
      outputPath: string;
      outputFormat: "mp4" | "ts";
      usedFallback: boolean;
      artifactIdentity: StreamRecordingArtifactIdentity;
    };

export interface StreamRecordingRequest {
  platform: Platform;
  channelName: string;
  /** Stable provider identity for the currently live Stream. */
  streamId?: string;
  title: string;
  /** Renderer-selected preference; the recorder resolves it to the nearest live variant. */
  desiredQuality?: StreamRecordingQuality | null;
}

export interface StreamRecordingSession extends StreamRecordingRequest {
  id: string;
  /** Stable identity of the Stream being captured; absent only in legacy journals. */
  streamId?: string;
  status: StreamRecordingStatus;
  destinationPath: string;
  qualityLabel: string | null;
  desiredQuality?: StreamRecordingQuality | null;
  currentQuality?: StreamRecordingQuality | null;
  qualityChange?: StreamRecordingQualityChange | null;
  recoveryExhaustion?: StreamRecordingRecoveryExhaustion | null;
  capturedDurationSeconds: number;
  sections: StreamRecordingSection[];
  gaps: StreamRecordingGap[];
  createdAt: string;
  updatedAt: string;
  outputFormat?: "mp4" | "ts" | null;
  committedOutputPath?: string | null;
  committedArtifactIdentity?: StreamRecordingArtifactIdentity | null;
  usedFallback?: boolean;
  partial?: boolean;
  statusMessage?: string | null;
}

export interface ActiveStreamRecording extends StreamRecordingRequest {
  sessionId?: string;
  status: StreamRecordingStatus;
  qualityLabel?: string | null;
  desiredQualityLabel?: string | null;
  currentQualityLabel?: string | null;
  qualityChange?: StreamRecordingQualityChange | null;
  recoveryExhaustionState?: StreamRecordingRecoveryExhaustion["state"] | null;
  recoveryFinalizeOnly?: boolean;
  recoveryResumeEligible?: boolean;
  recoveryResumeUnavailableReason?: "missing-stream-identity" | "finalization-checkpoint";
  capturedDurationSeconds?: number;
  gapCount?: number;
  hasOpenGap?: boolean;
  openGapStartedAt?: string | null;
  statusMessage?: string | null;
  partial?: boolean;
}

interface StreamRecordingNoticeBase extends StreamRecordingRequest {
  sessionId: string;
  delivery?: "in-app" | "native" | "none";
}

interface StreamRecordingOutputNoticeBase extends StreamRecordingNoticeBase {
  outputPath: string;
  outputFormat: "mp4" | "ts";
  usedFallback?: boolean;
  artifactIdentity: StreamRecordingArtifactIdentity;
}

export type StreamRecordingNotice =
  | (StreamRecordingOutputNoticeBase & { outcome: "completed" })
  | (StreamRecordingOutputNoticeBase & { outcome: "partial"; error?: string })
  | (StreamRecordingNoticeBase & { outcome: "failed"; error: string });

export type StreamRecordingJournalV2 =
  | { version: 2; state: "empty"; session: null }
  | {
      version: 2;
      state: "active" | "interrupted";
      session: StreamRecordingSession;
    };

export interface LegacyStreamRecordingJournalV1 {
  version: 1;
  session: StreamRecordingSession | null;
}

export type StreamRecordingJournal = StreamRecordingJournalV2 | LegacyStreamRecordingJournalV1;

export interface StreamRecordingSnapshot {
  active: ActiveStreamRecording | null;
  notice: StreamRecordingNotice | null;
}

export type ActiveStreamRecordingPhase = StreamRecordingStatus;

export type StreamRecordingLifecycleState =
  | { phase: "idle"; active: null; notice: null }
  | {
      phase: ActiveStreamRecordingPhase;
      active: ActiveStreamRecording;
      notice: null;
    }
  | {
      phase: "completed";
      active: null;
      notice: Extract<StreamRecordingNotice, { outcome: "completed" }>;
    }
  | {
      phase: "partial";
      active: null;
      notice: Extract<StreamRecordingNotice, { outcome: "partial" }>;
    }
  | {
      phase: "failed";
      active: null;
      notice: Extract<StreamRecordingNotice, { outcome: "failed" }>;
    };

export type StreamRecordingStartResult =
  | { success: true; outcome: "started"; sessionId: string }
  | { success: false; outcome: "cancelled"; error: string }
  | {
      success: false;
      outcome: "blocked";
      code: "stream-recording-active";
      error: string;
      activeRecording: ActiveStreamRecording;
    }
  | { success: false; outcome: "failed"; error: string };

export interface StreamRecordingActionResult {
  success: boolean;
  code?: "stream-changed" | "stream-unavailable";
  error?: string;
}

export type StreamRecordingRecoveryActionResult =
  | { success: true }
  | {
      success: false;
      code:
        | "busy"
        | "not-found"
        | "stream-unavailable"
        | "stream-changed"
        | "resume-failed"
        | "finalize-required"
        | "finalize-failed"
        | "dismiss-failed"
        | "confirmation-required"
        | "bridge-error";
      error: string;
    };
