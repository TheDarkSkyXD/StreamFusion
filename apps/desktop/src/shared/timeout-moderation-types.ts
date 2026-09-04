import { Platform } from "@streamfusion/core/platform";

export interface TimeoutActionBinding {
  platform: Platform;
  channelId: string;
  channelSlug: string;
  targetUserId: string;
  targetUsername: string;
  selectedMessageId?: string;
  action: "timeout";
}

export interface TimeoutActionPolicy {
  durationUnit: "seconds" | "minutes";
  minDuration: number;
  maxDuration: number;
  supportsReason: boolean;
  maxReasonLength: number;
}

export type TimeoutSnapshotResult =
  | {
      state: "available";
      snapshotId: string;
      verifiedAt: number;
      actorRole: "moderator" | "broadcaster";
      policy: TimeoutActionPolicy;
    }
  | {
      state: "unavailable";
      reason: "unauthorized" | "invalid-target-state" | "unverifiable";
    };

export interface TimeoutSubmitInput {
  snapshotId: string;
  duration: number;
  reason?: string;
}

export type TimeoutSubmitResult =
  | { state: "success"; attemptId: string }
  | {
      state: "failure";
      attemptId: string;
      code: "unauthorized" | "forbidden" | "not-found" | "rate-limited" | "network" | "unknown";
      message: string;
    }
  | {
      state: "revalidation-required";
      attemptId: string;
      reason: "missing-snapshot" | "stale-snapshot" | "state-changed";
    }
  | {
      state: "invalid-input";
      field: "duration" | "reason";
      message: string;
    };
