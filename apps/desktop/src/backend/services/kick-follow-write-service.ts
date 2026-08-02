import type { LocalFollow } from "@/shared/auth-types";
import {
  type FollowedChannelsResult,
  getAllFollowedChannels,
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
}

interface KickFollowWriteServiceDeps {
  storage: PendingStorage;
  writeKickAccountFollow: (request: {
    action: KickFollowWriteAction;
    channelSlug: string;
  }) => Promise<KickFollowWriteResult>;
  getAllFollowedChannels: (options?: {
    allowBrowserWindowFallback?: boolean;
  }) => Promise<FollowedChannelsResult>;
  now: () => Date;
  setTimer: (callback: () => void, delayMs: number) => unknown;
}

function sameKickChannel(
  a: { channelId: string; channelName?: string; slug?: string },
  b: { channelId: string; channelName?: string; slug?: string }
): boolean {
  if (a.channelId && b.channelId && a.channelId === b.channelId) return true;
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
  private readonly timers = new Map<number, unknown>();

  constructor(private readonly deps: KickFollowWriteServiceDeps) {}

  async enqueue(target: FollowInput, action: PendingFollowAction): Promise<KickFollowWriteOutcome> {
    const existing = this.deps.storage.getPendingFollowWritesByPlatform("kick");
    const opposite = existing.find(
      (row) => row.action !== action && row.status !== "failed" && sameKickChannel(row, target)
    );
    if (opposite) {
      throw new Error("Cancel the pending Kick follow action before starting the opposite action.");
    }

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
    const now = this.deps.now();
    if (Date.parse(row.expiresAt) <= now.getTime()) {
      return this.updateState(row, "failed", "retry-expired");
    }

    if (!this.deps.storage.hasToken("kick")) {
      return this.updateState(row, "auth-paused", "auth-required");
    }

    const write = await this.deps.writeKickAccountFollow({
      action: row.action,
      channelSlug: row.slug,
    });
    if (write.status === "error") {
      if (write.reason === "auth-failed") {
        return this.updateState(row, "auth-paused", write.reason);
      }
      return this.scheduleRetry(row, write.reason);
    }

    const sync = await this.deps.getAllFollowedChannels({ allowBrowserWindowFallback: true });
    if (sync.status === "error") {
      if (sync.reason === "auth-failed" || sync.reason === "no-token") {
        return this.updateState(row, "auth-paused", sync.reason);
      }
      return this.scheduleRetry(row, sync.reason);
    }

    const syncedFollows = sync.channels.map((channel) => ({
      platform: "kick" as const,
      channelId: channel.kickUserId ?? channel.id,
      channelName: channel.username,
      displayName: channel.displayName,
      profileImage: channel.avatarUrl,
    }));
    const syncedHasTarget = syncedFollows.some((follow) => sameKickChannel(follow, target));
    this.deps.storage.upsertSyncedFollows("kick", syncedFollows, {
      pruneAbsent: sync.canPruneAbsent,
    });

    const confirmed = this.deps.storage
      .getActiveFollowsByPlatform("kick")
      .find((follow) => sameKickChannel(follow, target));
    if (row.action === "follow" && confirmed) {
      this.deps.storage.removePendingFollowWrite(pendingKey(row));
      return { status: "confirmed", action: "follow", follow: confirmed };
    }
    if (row.action === "unfollow" && !syncedHasTarget) {
      if (confirmed) {
        this.deps.storage.removeLocalFollow(confirmed.id);
      }
      this.deps.storage.removePendingFollowWrite(pendingKey(row));
      return { status: "confirmed", action: "unfollow" };
    }

    return this.scheduleRetry(row, "not-confirmed");
  }

  cancel(row: PendingFollowWrite): boolean {
    const removed = this.deps.storage.removePendingFollowWrite(pendingKey(row));
    this.timers.delete(row.id);
    return removed;
  }

  retry(row: PendingFollowWrite): Promise<KickFollowWriteOutcome> {
    this.deps.storage.removePendingFollowWrite(pendingKey(row));
    this.timers.delete(row.id);
    return this.enqueue(targetFromPending(row), row.action);
  }

  resumePendingWrites(): void {
    for (const row of this.deps.storage.getPendingFollowWritesByPlatform("kick")) {
      if (row.status === "failed") continue;
      const delayMs = Math.max(0, Date.parse(row.nextAttemptAt) - this.deps.now().getTime());
      this.timers.set(
        row.id,
        this.deps.setTimer(() => {
          void this.process(row);
        }, delayMs)
      );
    }
  }

  private findPending(target: FollowInput, action: PendingFollowAction): PendingFollowWrite | null {
    return (
      this.deps.storage
        .getPendingFollowWritesByPlatform("kick")
        .find((row) => row.action === action && sameKickChannel(row, target)) ?? null
    );
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
    this.timers.set(
      row.id,
      this.deps.setTimer(() => {
        void this.process({ ...write.write, status: "retrying" });
      }, delayMs)
    );
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
    getAllFollowedChannels,
    now: () => new Date(),
    // timer-allowlist: injectable backend retry scheduler for pending Kick follow writes
    setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
    ...deps,
  });
}

export const kickFollowWriteService = createKickFollowWriteService();
