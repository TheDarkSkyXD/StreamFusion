import type { Platform } from "@/shared/auth-types";
import type { TimeoutActionBinding, TimeoutActionPolicy } from "@/shared/timeout-moderation-types";
import { createCancellableSleep, type CancellableSleep } from "@/lib/sleep";

export type TimeoutBinding = TimeoutActionBinding;
export type TimeoutPolicy = TimeoutActionPolicy;

export interface VerifiedTimeoutInspection {
  state: "verified";
  actor: { id: string; username?: string; role: "moderator" | "broadcaster" };
  target: { state: "clear" };
  policy: TimeoutPolicy;
}

export type TimeoutInspection =
  | VerifiedTimeoutInspection
  | {
      state: "unavailable";
      reason: "unauthorized" | "invalid-target-state" | "unverifiable";
    };

export interface TimeoutAuthorityAdapter {
  inspectTimeoutTarget(binding: TimeoutBinding): Promise<TimeoutInspection>;
  executeTimeout(input: {
    binding: TimeoutBinding;
    actor: VerifiedTimeoutInspection["actor"];
    duration: number;
    reason?: string;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        code: "unauthorized" | "forbidden" | "not-found" | "rate-limited" | "network" | "unknown";
        safeMessage: string;
      }
  >;
}

interface StoredTimeoutSnapshot {
  binding: TimeoutBinding;
  actor: VerifiedTimeoutInspection["actor"];
  policy: TimeoutPolicy;
  verifiedAt: number;
}

const SNAPSHOT_TTL_MS = 30_000;
const DEFAULT_MAX_SNAPSHOTS = 256;

export function createTimeoutModerationService(options: {
  adapters: Record<Platform, TimeoutAuthorityAdapter>;
  now?: () => number;
  createId?: () => string;
  maxSnapshots?: number;
  persistSuccess?: (input: {
    attemptId: string;
    binding: TimeoutBinding;
    actor: VerifiedTimeoutInspection["actor"];
    duration: number;
    reason?: string;
  }) => Promise<void>;
}) {
  const snapshots = new Map<string, StoredTimeoutSnapshot>();
  const submissions = new Map<
    string,
    Promise<
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
          reason: "state-changed";
        }
    >
  >();
  const snapshotCleanupDelays = new Map<string, CancellableSleep>();
  const now = options.now ?? Date.now;
  const createId = options.createId ?? (() => crypto.randomUUID());
  const maxSnapshots = Math.max(1, options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS);

  const deleteSnapshot = (snapshotId: string) => {
    snapshots.delete(snapshotId);
    const cleanupDelay = snapshotCleanupDelays.get(snapshotId);
    snapshotCleanupDelays.delete(snapshotId);
    cleanupDelay?.cancel();
  };
  const scheduleSnapshotCleanup = (snapshotId: string) => {
    snapshotCleanupDelays.get(snapshotId)?.cancel();
    const cleanupDelay = createCancellableSleep(SNAPSHOT_TTL_MS, { unref: true });
    snapshotCleanupDelays.set(snapshotId, cleanupDelay);
    void (async () => {
      const result = await cleanupDelay.result;
      if (!result.ok || snapshotCleanupDelays.get(snapshotId) !== cleanupDelay) return;
      snapshotCleanupDelays.delete(snapshotId);
      if (submissions.has(snapshotId)) {
        scheduleSnapshotCleanup(snapshotId);
        return;
      }
      snapshots.delete(snapshotId);
    })();
  };

  return {
    async createSnapshot(binding: TimeoutBinding) {
      const inspection = await options.adapters[binding.platform].inspectTimeoutTarget(binding);
      if (inspection.state !== "verified") return inspection;

      const snapshotId = createId();
      const verifiedAt = now();
      while (snapshots.size >= maxSnapshots) {
        const oldestSnapshotId = snapshots.keys().next().value;
        if (oldestSnapshotId === undefined) break;
        deleteSnapshot(oldestSnapshotId);
      }
      snapshots.set(snapshotId, {
        binding: { ...binding },
        actor: { ...inspection.actor },
        policy: { ...inspection.policy },
        verifiedAt,
      });
      scheduleSnapshotCleanup(snapshotId);
      return {
        state: "available" as const,
        snapshotId,
        verifiedAt,
        actorRole: inspection.actor.role,
        policy: inspection.policy,
      };
    },
    async submitTimeout(input: { snapshotId: string; duration: number; reason?: string }) {
      const snapshot = snapshots.get(input.snapshotId);
      if (!snapshot) {
        const attemptId = createId();
        return {
          state: "revalidation-required" as const,
          attemptId,
          reason: "missing-snapshot" as const,
        };
      }
      if (now() - snapshot.verifiedAt > SNAPSHOT_TTL_MS) {
        deleteSnapshot(input.snapshotId);
        return {
          state: "revalidation-required" as const,
          attemptId: createId(),
          reason: "stale-snapshot" as const,
        };
      }
      const { policy } = snapshot;
      if (
        !Number.isInteger(input.duration) ||
        input.duration < policy.minDuration ||
        input.duration > policy.maxDuration
      ) {
        return {
          state: "invalid-input" as const,
          field: "duration" as const,
          message: `Enter a whole number from ${policy.minDuration} to ${policy.maxDuration} ${policy.durationUnit}.`,
        };
      }
      if (
        input.reason &&
        (!policy.supportsReason || input.reason.length > policy.maxReasonLength)
      ) {
        return {
          state: "invalid-input" as const,
          field: "reason" as const,
          message: policy.supportsReason
            ? `Reason must be ${policy.maxReasonLength} characters or fewer.`
            : "A reason is not supported on this platform.",
        };
      }

      const pendingSubmission = submissions.get(input.snapshotId);
      if (pendingSubmission) return pendingSubmission;

      const attemptId = createId();
      const adapter = options.adapters[snapshot.binding.platform];
      const submission = (async () => {
        const inspection = await adapter.inspectTimeoutTarget(snapshot.binding);
        if (
          inspection.state !== "verified" ||
          inspection.actor.id !== snapshot.actor.id ||
          inspection.actor.role !== snapshot.actor.role
        ) {
          deleteSnapshot(input.snapshotId);
          return {
            state: "revalidation-required" as const,
            attemptId,
            reason: "state-changed" as const,
          };
        }

        const result = await adapter.executeTimeout({
          binding: snapshot.binding,
          actor: inspection.actor,
          duration: input.duration,
          ...(input.reason ? { reason: input.reason } : {}),
        });
        if (result.ok) {
          await options.persistSuccess?.({
            attemptId,
            binding: snapshot.binding,
            actor: inspection.actor,
            duration: input.duration,
            ...(input.reason ? { reason: input.reason } : {}),
          });
          deleteSnapshot(input.snapshotId);
          return { state: "success" as const, attemptId };
        }
        return {
          state: "failure" as const,
          attemptId,
          code: result.code,
          message: result.safeMessage,
        };
      })();
      submissions.set(input.snapshotId, submission);
      try {
        return await submission;
      } finally {
        if (submissions.get(input.snapshotId) === submission) {
          submissions.delete(input.snapshotId);
        }
      }
    },
    getSnapshotForTest(snapshotId: string): StoredTimeoutSnapshot | undefined {
      return snapshots.get(snapshotId);
    },
  };
}
