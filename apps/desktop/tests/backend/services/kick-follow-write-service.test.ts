import { beforeEach, describe, expect, it, vi } from "vitest";

import { createKickFollowWriteService } from "@/backend/services/kick-follow-write-service";
import type { PendingFollowWrite } from "@/backend/services/database-service";
import type { LocalFollow } from "@/shared/auth-types";

const target = {
  platform: "kick",
  channelId: "411439",
  channelName: "blame",
  displayName: "blame",
  profileImage: "",
} satisfies Omit<LocalFollow, "id" | "followedAt">;

function makePending(
  overrides: Partial<PendingFollowWrite> = {}
): PendingFollowWrite {
  return {
    id: 1,
    platform: "kick",
    channelId: "411439",
    slug: "blame",
    action: "follow",
    status: "pending",
    createdAt: "2026-07-04T03:00:00.000Z",
    attemptedAt: "2026-07-04T03:00:00.000Z",
    nextAttemptAt: "2026-07-04T03:00:00.000Z",
    expiresAt: "2026-07-04T03:10:00.000Z",
    attemptCount: 0,
    lastError: null,
    ...overrides,
  };
}

// Guards: Kick write HTTP success is not confirmation; unconfirmed write state persists for retry.
describe("kick-follow-write-service", () => {
  const storage = {
    hasToken: vi.fn(),
    addPendingFollowWrite: vi.fn(),
    removePendingFollowWrite: vi.fn(),
    updatePendingFollowWriteState: vi.fn(),
    getPendingFollowWritesByPlatform: vi.fn(),
    upsertSyncedFollows: vi.fn(),
    getActiveFollowsByPlatform: vi.fn(),
    removeLocalFollow: vi.fn(),
  };
  const writeKickAccountFollow = vi.fn();
  const getAllFollowedChannels = vi.fn();
  const setTimer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    storage.hasToken.mockReturnValue(true);
    storage.getPendingFollowWritesByPlatform.mockReturnValue([makePending()]);
    storage.updatePendingFollowWriteState.mockReturnValue(true);
    storage.removePendingFollowWrite.mockReturnValue(true);
    storage.upsertSyncedFollows.mockReturnValue({
      accountCount: 0,
      pendingCount: 1,
      addedCount: 0,
      removedCount: 0,
    });
    storage.getActiveFollowsByPlatform.mockReturnValue([]);
    storage.removeLocalFollow.mockReturnValue(true);
    writeKickAccountFollow.mockResolvedValue({ status: "ok" });
    getAllFollowedChannels.mockResolvedValue({
      status: "ok",
      channels: [],
      canPruneAbsent: true,
    });
    setTimer.mockReturnValue(1);
  });

  it("stores an unconfirmed follow write as pending and schedules retry", async () => {
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getAllFollowedChannels,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    const result = await service.enqueue(target, "follow");

    expect(result.status).toBe("pending");
    expect(storage.addPendingFollowWrite).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      slug: "blame",
      action: "follow",
      now: new Date("2026-07-04T03:00:00.000Z"),
    });
    expect(storage.updatePendingFollowWriteState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        lastError: "not-confirmed",
      })
    );
    expect(setTimer).toHaveBeenCalled();
  });

  it("clears the pending follow when sync confirms the channel", async () => {
    const confirmed = {
      ...target,
      id: "confirmed-row",
      followedAt: "2026-07-04T03:00:00.000Z",
      source: "kick",
    } as LocalFollow;
    getAllFollowedChannels.mockResolvedValue({
      status: "ok",
      channels: [
        {
          id: "411439",
          platform: "kick",
          username: "blame",
          displayName: "blame",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        },
      ],
      canPruneAbsent: true,
    });
    storage.getActiveFollowsByPlatform.mockReturnValue([confirmed]);
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getAllFollowedChannels,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    const result = await service.enqueue(target, "follow");

    expect(result).toEqual({ status: "confirmed", action: "follow", follow: confirmed });
    expect(storage.removePendingFollowWrite).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      slug: "blame",
      action: "follow",
    });
    expect(setTimer).not.toHaveBeenCalled();
  });

  it("clears a pending unfollow when sync omits the target even if broad pruning is disabled", async () => {
    const confirmed = {
      ...target,
      id: "confirmed-row",
      followedAt: "2026-07-04T03:00:00.000Z",
      source: "kick",
    } as LocalFollow;
    storage.getPendingFollowWritesByPlatform.mockReturnValue([
      makePending({ action: "unfollow" }),
    ]);
    getAllFollowedChannels.mockResolvedValue({
      status: "ok",
      channels: [
        {
          id: "not-blame",
          platform: "kick",
          username: "notblame",
          displayName: "notblame",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        },
      ],
      canPruneAbsent: false,
    });
    storage.getActiveFollowsByPlatform.mockReturnValue([confirmed]);
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getAllFollowedChannels,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    const result = await service.enqueue(target, "unfollow");

    expect(result).toEqual({ status: "confirmed", action: "unfollow" });
    expect(storage.removeLocalFollow).toHaveBeenCalledWith("confirmed-row");
    expect(storage.removePendingFollowWrite).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      slug: "blame",
      action: "unfollow",
    });
    expect(setTimer).not.toHaveBeenCalled();
  });

  it("pauses a pending write when Kick auth is unavailable", async () => {
    storage.hasToken.mockReturnValue(false);
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getAllFollowedChannels,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    const result = await service.enqueue(target, "follow");

    expect(result.status).toBe("auth-paused");
    expect(storage.updatePendingFollowWriteState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "auth-paused",
        lastError: "auth-required",
      })
    );
    expect(writeKickAccountFollow).not.toHaveBeenCalled();
  });

  it("marks a write failed when the retry window has expired", async () => {
    storage.getPendingFollowWritesByPlatform.mockReturnValue([
      makePending({ expiresAt: "2026-07-04T03:00:00.000Z" }),
    ]);
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getAllFollowedChannels,
      now: () => new Date("2026-07-04T03:10:01.000Z"),
      setTimer,
    });

    const result = await service.enqueue(target, "follow");

    expect(result.status).toBe("failed");
    expect(storage.updatePendingFollowWriteState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: "retry-expired",
      })
    );
    expect(writeKickAccountFollow).not.toHaveBeenCalled();
  });

  it("cancels a pending write by removing the persisted row", () => {
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getAllFollowedChannels,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    const canceled = service.cancel(makePending());

    expect(canceled).toBe(true);
    expect(storage.removePendingFollowWrite).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      slug: "blame",
      action: "follow",
    });
  });

  it("rejects the opposite action while a same-channel pending write is active", async () => {
    storage.getPendingFollowWritesByPlatform.mockReturnValue([makePending({ action: "follow" })]);
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getAllFollowedChannels,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    await expect(service.enqueue(target, "unfollow")).rejects.toThrow(
      "Cancel the pending Kick follow action"
    );

    expect(storage.addPendingFollowWrite).not.toHaveBeenCalled();
  });

  it("schedules startup resume for non-failed pending writes", () => {
    storage.getPendingFollowWritesByPlatform.mockReturnValue([
      makePending({ id: 1, nextAttemptAt: "2026-07-04T03:00:05.000Z" }),
      makePending({ id: 2, status: "failed", nextAttemptAt: "2026-07-04T03:00:05.000Z" }),
    ]);
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getAllFollowedChannels,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    service.resumePendingWrites();

    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it("retries a failed write by resetting the pending row and attempting again", async () => {
    const failed = makePending({ status: "failed", lastError: "retry-expired" });
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getAllFollowedChannels,
      now: () => new Date("2026-07-04T03:20:00.000Z"),
      setTimer,
    });

    await service.retry(failed);

    expect(storage.removePendingFollowWrite).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      slug: "blame",
      action: "follow",
    });
    expect(storage.addPendingFollowWrite).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      slug: "blame",
      action: "follow",
      now: new Date("2026-07-04T03:20:00.000Z"),
    });
  });
});
