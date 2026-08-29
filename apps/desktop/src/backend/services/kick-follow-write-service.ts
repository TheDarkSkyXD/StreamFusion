import type { KickAccountFollowWriteChangedEvent, LocalFollow } from "@shared/auth-types";
import {
  getKickAccountFollowState,
  type KickAccountFollowState,
} from "../api/platforms/kick/kick-public-profile-reader";
import {
  type KickFollowWriteAction,
  type KickFollowWriteResult,
  writeKickAccountFollow,
} from "../api/platforms/kick/endpoints/follow-endpoints";
import type {
  PendingFollowAction,
  PendingFollowWrite,
  PendingFollowWriteStatus,
} from "./database-service";
import { storageService } from "./storage-service";

type FollowInput = Omit<LocalFollow, "id" | "followedAt">;

type KickFollowWriteOutcome =
  | { status: "confirmed"; action: "follow"; follow: LocalFollow }
  | { status: "confirmed"; action: "unfollow" }
  | { status: "pending" | "auth-paused" | "failed"; write: PendingFollowWrite };

type NonConfirmedKickFollowWriteStatus = "pending" | "auth-paused" | "failed";
type NonConfirmedKickFollowWriteOutcome = Extract<
  KickFollowWriteOutcome,
  { status: NonConfirmedKickFollowWriteStatus }
>;

interface PendingStorage {
  hasToken(platform: "kick"): boolean;
  addPendingFollowWrite(input: {
    platform: "kick";
    channelId: string;
    slug: string;
    action: PendingFollowAction;
    now?: Date;
    lastError?: string | null;
  }): void;
  removePendingFollowWrite(input: {
    platform: "kick";
    channelId: string;
    slug: string;
    action: PendingFollowAction;
  }): boolean;
  updatePendingFollowWriteState(input: {
    platform: "kick";
    channelId: string;
    slug: string;
    action: PendingFollowAction;
    status: PendingFollowWriteStatus;
    attemptedAt?: Date;
    nextAttemptAt?: Date;
    attemptCount?: number;
    lastError?: string | null;
  }): boolean;
  getPendingFollowWritesByPlatform(platform: "kick"): PendingFollowWrite[];
  upsertSyncedFollows(
    platform: "kick",
    follows: FollowInput[],
    options?: { pruneAbsent?: boolean }
  ): { accountCount: number; pendingCount: number; addedCount: number; removedCount: number };
  getActiveFollowsByPlatform(platform: "kick"): LocalFollow[];
  removeLocalFollow(id: string): boolean;
  confirmKickFollow(follow: FollowInput & { platform: "kick" }): LocalFollow;
  confirmKickUnfollow(input: { channelId: string; slug: string; localFollowId?: string }): boolean;
  getKickUser(): { id: number; username: string; slug: string } | null;
}

interface KickFollowWriteServiceDeps {
  storage: PendingStorage;
  writeKickAccountFollow: (request: {
    action: KickFollowWriteAction;
    channelSlug: string;
  }) => Promise<KickFollowWriteResult>;
  getKickAccountFollowState: (
    userId: string,
    username: string,
    channelSlug: string,
    options?: { fresh?: boolean }
  ) => Promise<KickAccountFollowState>;
  now: () => Date;
  setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
}

function sameKickChannel(
  a: { channelId: string; channelName?: string; slug?: string },
  b: { channelId: string; channelName?: string; slug?: string }
): boolean {
  if (a.channelId && b.channelId) return a.channelId === b.channelId;
  const aSlug = (a.channelName ?? a.slug ?? "").toLowerCase();
  const bSlug = (b.channelName ?? b.slug ?? "").toLowerCase();
  return Boolean(aSlug && bSlug && aSlug === bSlug);
}

function pendingKey(row: Pick<PendingFollowWrite, "channelId" | "slug" | "action">) {
  return {
    platform: "kick" as const,
    channelId: row.channelId,
    slug: row.slug,
    action: row.action,
  };
}

function targetFromPending(row: PendingFollowWrite): FollowInput {
  return {
    platform: "kick",
    channelId: row.channelId,
    channelName: row.slug,
    displayName: row.slug,
    profileImage: "",
  };
}

export class KickFollowWriteService {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<(event: KickAccountFollowWriteChangedEvent) => void>();

  constructor(private readonly deps: KickFollowWriteServiceDeps) {}

  onAccountWriteChanged(listener: (event: KickAccountFollowWriteChangedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async enqueue(target: FollowInput, action: PendingFollowAction): Promise<KickFollowWriteOutcome> {
    const existing = this.deps.storage.getPendingFollowWritesByPlatform("kick");
    const opposite = existing.find(
      (row) => row.action !== action && row.status !== "failed" && sameKickChannel(row, target)
    );
    if (opposite) {
      throw new Error("Cancel the pending Kick follow action before starting the opposite action.");
    }
    const sameAction = existing.find(
      (row) => row.action === action && sameKickChannel(row, target)
    );
    if (sameAction?.status === "failed") {
      return this.retry(sameAction);
    }
    if (sameAction) {
      return {
        status: sameAction.status === "retrying" ? "pending" : sameAction.status,
        write: sameAction,
      };
    }

    return this.startWrite(target, action);
  }

  private async startWrite(
    target: FollowInput,
    action: PendingFollowAction
  ): Promise<KickFollowWriteOutcome> {
    const now = this.deps.now();
    this.deps.storage.addPendingFollowWrite({
      platform: "kick",
      channelId: target.channelId,
      slug: target.channelName,
      action,
      now,
    });

    const row = this.findPending(target, action);
    if (!row) {
      throw new Error("Kick follow write was not persisted.");
    }
    return this.process(row, target);
  }

  async process(
    row: PendingFollowWrite,
    target = targetFromPending(row)
  ): Promise<KickFollowWriteOutcome> {
    const publish = (outcome: KickFollowWriteOutcome) => {
      const event: KickAccountFollowWriteChangedEvent = {
        status: outcome.status,
        action: row.action,
        target: {
          platform: "kick",
          channelId: target.channelId,
          channelName: target.channelName,
        },
        activeFollows: this.deps.storage.getActiveFollowsByPlatform("kick"),
        ...((outcome.status === "failed" || outcome.status === "auth-paused") &&
        outcome.write.lastError
          ? { reason: outcome.write.lastError }
          : {}),
      };
      for (const listener of this.listeners) listener(event);
      return outcome;
    };
    const now = this.deps.now();
    if (Date.parse(row.expiresAt) <= now.getTime()) {
      return publish(this.updateState(row, "failed", "retry-expired"));
    }

    if (!this.deps.storage.hasToken("kick")) {
      return publish(this.updateState(row, "auth-paused", "auth-required"));
    }
    const initialViewer = this.deps.storage.getKickUser();
    if (!initialViewer) {
      return publish(this.updateState(row, "auth-paused", "auth-required"));
    }
    const viewerIdentity = {
      id: initialViewer.id,
      username: (initialViewer.slug || initialViewer.username).toLowerCase(),
    };

    const write = await this.deps.writeKickAccountFollow({
      action: row.action,
      channelSlug: row.slug,
    });
    let writeFailureReason: string | null = null;
    if (write.status === "error") {
      if (write.reason === "auth-failed") {
        return publish(this.updateState(row, "auth-paused", write.reason));
      }
      writeFailureReason = write.reason;
    }

    let relationship: KickAccountFollowState = "unavailable";
    try {
      relationship = await this.deps.getKickAccountFollowState(
        String(viewerIdentity.id),
        viewerIdentity.username,
        row.slug,
        { fresh: true }
      );
    } catch {
      // Only an explicit identity-matched relationship confirms a write.
    }

    const currentViewer = this.deps.storage.getKickUser();
    if (
      !this.deps.storage.hasToken("kick") ||
      !currentViewer ||
      currentViewer.id !== viewerIdentity.id ||
      (currentViewer.slug || currentViewer.username).toLowerCase() !== viewerIdentity.username
    ) {
      return publish(this.updateState(row, "auth-paused", "auth-required"));
    }

    if (row.action === "follow" && relationship === "followed") {
      const confirmed = this.deps.storage.confirmKickFollow({ ...target, platform: "kick" });
      this.clearScheduledTimer(row.id);
      return publish({ status: "confirmed", action: "follow", follow: confirmed });
    }

    if (row.action === "unfollow" && relationship === "not-followed") {
      const confirmed = this.deps.storage
        .getActiveFollowsByPlatform("kick")
        .find((follow) => sameKickChannel(follow, target));
      this.deps.storage.confirmKickUnfollow({
        channelId: row.channelId,
        slug: row.slug,
        ...(confirmed ? { localFollowId: confirmed.id } : {}),
      });
      this.clearScheduledTimer(row.id);
      return publish({ status: "confirmed", action: "unfollow" });
    }

    return publish(this.scheduleRetry(row, writeFailureReason ?? "not-confirmed"));
  }

  cancel(row: PendingFollowWrite): boolean {
    const removed = this.deps.storage.removePendingFollowWrite(pendingKey(row));
    this.clearScheduledTimer(row.id);
    return removed;
  }

  retry(row: PendingFollowWrite): Promise<KickFollowWriteOutcome> {
    this.deps.storage.removePendingFollowWrite(pendingKey(row));
    this.clearScheduledTimer(row.id);
    const target = targetFromPending(row);
    const opposite = this.deps.storage
      .getPendingFollowWritesByPlatform("kick")
      .find(
        (candidate) =>
          candidate.action !== row.action &&
          candidate.status !== "failed" &&
          sameKickChannel(candidate, target)
      );
    if (opposite) {
      throw new Error("Cancel the pending Kick follow action before starting the opposite action.");
    }
    return this.startWrite(target, row.action);
  }

  resumePendingWrites(): void {
    for (const row of this.deps.storage.getPendingFollowWritesByPlatform("kick")) {
      if (row.status === "failed") continue;
      const delayMs = Math.max(0, Date.parse(row.nextAttemptAt) - this.deps.now().getTime());
      this.schedulePersistedWrite(row, delayMs);
    }
  }

  private schedulePersistedWrite(row: PendingFollowWrite, delayMs: number): void {
    this.clearScheduledTimer(row.id);
    const handle = this.deps.setTimer(() => {
      if (this.timers.get(row.id) !== handle) return;
      this.timers.delete(row.id);
      const persisted = this.deps.storage
        .getPendingFollowWritesByPlatform("kick")
        .find((candidate) => candidate.id === row.id && candidate.action === row.action);
      if (!persisted) return;
      void this.process({ ...persisted, status: "retrying" });
    }, delayMs);
    this.timers.set(row.id, handle);
  }

  private findPending(target: FollowInput, action: PendingFollowAction): PendingFollowWrite | null {
    return (
      this.deps.storage
        .getPendingFollowWritesByPlatform("kick")
        .find((row) => row.action === action && sameKickChannel(row, target)) ?? null
    );
  }

  private clearScheduledTimer(id: number): void {
    const handle = this.timers.get(id);
    if (handle === undefined) return;
    this.deps.clearTimer(handle);
    this.timers.delete(id);
  }

  private scheduleRetry(
    row: PendingFollowWrite,
    lastError: string
  ): NonConfirmedKickFollowWriteOutcome {
    const now = this.deps.now();
    const attemptCount = row.attemptCount + 1;
    const delayMs = Math.min(1000 * 2 ** Math.max(0, attemptCount - 1), 30_000);
    const nextAttemptAt = new Date(now.getTime() + delayMs);
    const expiresAtMs = Date.parse(row.expiresAt);
    if (nextAttemptAt.getTime() > expiresAtMs) {
      return this.updateState(row, "failed", "retry-expired", now, undefined, attemptCount);
    }

    const write = this.updateState(row, "pending", lastError, now, nextAttemptAt, attemptCount);
    this.schedulePersistedWrite(write.write, delayMs);
    return write;
  }

  private updateState(
    row: PendingFollowWrite,
    status: NonConfirmedKickFollowWriteStatus,
    lastError: string,
    attemptedAt = this.deps.now(),
    nextAttemptAt?: Date,
    attemptCount = row.attemptCount
  ): NonConfirmedKickFollowWriteOutcome {
    if (status !== "pending") this.clearScheduledTimer(row.id);
    this.deps.storage.updatePendingFollowWriteState({
      ...pendingKey(row),
      status,
      attemptedAt,
      nextAttemptAt,
      attemptCount,
      lastError,
    });
    return {
      status,
      write: {
        ...row,
        status,
        attemptedAt: attemptedAt.toISOString(),
        nextAttemptAt: nextAttemptAt?.toISOString() ?? row.nextAttemptAt,
        attemptCount,
        lastError,
      },
    };
  }
}

export function createKickFollowWriteService(
  deps: Partial<KickFollowWriteServiceDeps> = {}
): KickFollowWriteService {
  return new KickFollowWriteService({
    storage: storageService,
    writeKickAccountFollow,
    getKickAccountFollowState,
    now: () => new Date(),
    // timer-allowlist: injectable backend retry scheduler for pending Kick follow writes
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer: (handle) => clearTimeout(handle),
    ...deps,
  });
}

export const kickFollowWriteService = createKickFollowWriteService();
