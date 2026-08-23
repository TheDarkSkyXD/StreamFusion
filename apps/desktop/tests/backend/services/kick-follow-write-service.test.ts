import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchKickWebApiMutationMock = vi.hoisted(() => vi.fn());

vi.mock("@/backend/api/platforms/kick/kick-send-window", () => ({
  fetchKickWebApiMutation: fetchKickWebApiMutationMock,
}));

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

function makePending(overrides: Partial<PendingFollowWrite> = {}): PendingFollowWrite {
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
// Guards: Kick HTTP 422 writes remain indeterminate until a trusted followed-channel sync confirms the requested state.
// Guards: Stable Kick IDs take precedence over matching slugs so one identity cannot remove another.
// Guards: cancel, retry, and terminal state transitions clear scheduled retry handles.
// Guards: terminal and auth-paused writes publish only sanitized reason codes for renderer feedback.
// Guards: duplicate same-action enqueue calls reuse active persisted intent without another Kick attempt or transition.
// Guards: re-enqueueing a failed write replaces its expired attempt state before retrying Kick.
// Guards: retry timers re-check persistence and cannot replay a write reconciled away before firing.
// Guards: an unfollow of a stale false account row settles from a fresh viewer-specific not-followed relationship even when the DOM list is additive.
// Guards: post-write scraped recommendations are never persisted by the targeted write service.
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
    confirmKickFollow: vi.fn(),
    confirmKickUnfollow: vi.fn(),
    getKickUser: vi.fn(),
  };
  const writeKickAccountFollow = vi.fn();
  const getAllFollowedChannels = vi.fn();
  const setTimer = vi.fn();
  const clearTimer = vi.fn();
  const getKickAccountFollowState = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    storage.hasToken.mockReturnValue(true);
    storage.getPendingFollowWritesByPlatform.mockImplementation(() =>
      storage.addPendingFollowWrite.mock.calls.length > 0 ? [makePending()] : []
    );
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
    storage.confirmKickUnfollow.mockImplementation((input) => {
      if (input.localFollowId) storage.removeLocalFollow(input.localFollowId);
      storage.removePendingFollowWrite({
        platform: "kick",
        channelId: input.channelId,
        slug: input.slug,
        action: "unfollow",
      });
      return true;
    });
    storage.confirmKickFollow.mockImplementation((follow) => {
      storage.upsertSyncedFollows("kick", [follow], { pruneAbsent: false });
      storage.removePendingFollowWrite({
        platform: "kick",
        channelId: follow.channelId,
        slug: follow.channelName,
        action: "follow",
      });
      return (
        storage
          .getActiveFollowsByPlatform("kick")
          .find((row: LocalFollow) => row.channelId === follow.channelId) ?? {
          ...follow,
          id: `kick-kick-${follow.channelId}`,
          followedAt: "2026-07-04T03:00:00.000Z",
          source: "kick",
        }
      );
    });
    storage.getKickUser.mockReturnValue({ id: 123, username: "viewer", slug: "viewer" });
    getKickAccountFollowState.mockResolvedValue("unavailable");
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
      getKickAccountFollowState,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });
    const onAccountWriteChanged = vi.fn();
    service.onAccountWriteChanged(onAccountWriteChanged);

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
    expect(onAccountWriteChanged).toHaveBeenCalledWith({
      status: "pending",
      action: "follow",
      target: {
        platform: "kick",
        channelId: "411439",
        channelName: "blame",
      },
      activeFollows: [],
    });
  });

  it("does not persist unrelated channels returned by the additive DOM scan", async () => {
    getAllFollowedChannels.mockResolvedValue({
      status: "ok",
      channels: [
        {
          id: "99",
          platform: "kick",
          username: "paymoneywubby",
          displayName: "PaymoneyWubby",
          avatarUrl: "",
          isLive: true,
          isVerified: true,
          isPartner: true,
        },
      ],
      canPruneAbsent: false,
    });
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getKickAccountFollowState,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    await service.enqueue(target, "follow");

    expect(storage.upsertSyncedFollows).not.toHaveBeenCalled();
  });

  it.each(["follow", "unfollow"] as const)(
    "does not confirm a %s after the authenticated Kick account changes",
    async (action) => {
      storage.getKickUser
        .mockReturnValueOnce({ id: 123, username: "viewer-a", slug: "viewer-a" })
        .mockReturnValueOnce({ id: 456, username: "viewer-b", slug: "viewer-b" });
      getKickAccountFollowState.mockResolvedValue(
        action === "follow" ? "followed" : "not-followed"
      );
      storage.getPendingFollowWritesByPlatform
        .mockReturnValueOnce([])
        .mockReturnValue([makePending({ action })]);
      const service = createKickFollowWriteService({
        storage,
        writeKickAccountFollow,
        getKickAccountFollowState,
        now: () => new Date("2026-07-04T03:00:00.000Z"),
        setTimer,
      });

      await expect(service.enqueue(target, action)).resolves.toMatchObject({
        status: "auth-paused",
      });
      expect(storage.confirmKickFollow).not.toHaveBeenCalled();
      expect(storage.confirmKickUnfollow).not.toHaveBeenCalled();
    }
  );

  it("clears the pending follow when sync confirms the channel", async () => {
    getKickAccountFollowState.mockResolvedValue("followed");
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
      getKickAccountFollowState,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });
    const onAccountWriteChanged = vi.fn();
    service.onAccountWriteChanged(onAccountWriteChanged);

    const result = await service.enqueue(target, "follow");

    expect(result).toEqual({ status: "confirmed", action: "follow", follow: confirmed });
    expect(storage.removePendingFollowWrite).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      slug: "blame",
      action: "follow",
    });
    expect(setTimer).not.toHaveBeenCalled();
    expect(onAccountWriteChanged).toHaveBeenCalledWith({
      status: "confirmed",
      action: "follow",
      target: {
        platform: "kick",
        channelId: "411439",
        channelName: "blame",
      },
      activeFollows: [confirmed],
    });
  });

  it("confirms an absent unfollow only after a trusted followed-channel sync", async () => {
    getKickAccountFollowState
      .mockResolvedValueOnce("unavailable")
      .mockResolvedValueOnce("not-followed");
    const confirmed = {
      ...target,
      id: "confirmed-row",
      followedAt: "2026-07-04T03:00:00.000Z",
      source: "kick",
    } as LocalFollow;
    storage.getPendingFollowWritesByPlatform
      .mockReturnValueOnce([])
      .mockReturnValue([makePending({ action: "unfollow" })]);
    getAllFollowedChannels
      .mockResolvedValueOnce({
        status: "ok",
        channels: [],
        canPruneAbsent: false,
      })
      .mockResolvedValueOnce({
        status: "ok",
        channels: [],
        canPruneAbsent: true,
      });
    let activeFollows = [confirmed];
    storage.getActiveFollowsByPlatform.mockImplementation(() => activeFollows);
    storage.removeLocalFollow.mockImplementation(() => {
      activeFollows = [];
      return true;
    });
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getKickAccountFollowState,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });
    const onAccountWriteChanged = vi.fn();
    service.onAccountWriteChanged(onAccountWriteChanged);

    const untrustedAttempt = await service.enqueue(target, "unfollow");

    expect(untrustedAttempt).toEqual(
      expect.objectContaining({
        status: "pending",
        write: expect.objectContaining({ lastError: "not-confirmed" }),
      })
    );
    expect(storage.removeLocalFollow).not.toHaveBeenCalled();
    expect(storage.removePendingFollowWrite).not.toHaveBeenCalled();
    expect(onAccountWriteChanged).toHaveBeenLastCalledWith({
      status: "pending",
      action: "unfollow",
      target: {
        platform: "kick",
        channelId: "411439",
        channelName: "blame",
      },
      activeFollows: [confirmed],
    });

    if (untrustedAttempt.status !== "pending") throw new Error("Expected pending unfollow");
    const trustedAttempt = await service.process(untrustedAttempt.write, target);

    expect(trustedAttempt).toEqual({ status: "confirmed", action: "unfollow" });
    expect(storage.removeLocalFollow).toHaveBeenCalledWith("confirmed-row");
    expect(storage.removePendingFollowWrite).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "411439",
      slug: "blame",
      action: "unfollow",
    });
    expect(onAccountWriteChanged).toHaveBeenLastCalledWith({
      status: "confirmed",
      action: "unfollow",
      target: {
        platform: "kick",
        channelId: "411439",
        channelName: "blame",
      },
      activeFollows: [],
    });
  });

  it("confirms a stale-row unfollow from a fresh target relationship", async () => {
    const stale = {
      ...target,
      id: "stale-row",
      followedAt: "2026-07-04T03:00:00.000Z",
      source: "kick",
    } as LocalFollow;
    storage.getPendingFollowWritesByPlatform
      .mockReturnValueOnce([])
      .mockReturnValue([makePending({ action: "unfollow" })]);
    storage.getActiveFollowsByPlatform.mockReturnValue([stale]);
    getAllFollowedChannels.mockResolvedValue({
      status: "ok",
      channels: [],
      canPruneAbsent: false,
    });
    getKickAccountFollowState.mockResolvedValue("not-followed");
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getKickAccountFollowState,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    await expect(service.enqueue(target, "unfollow")).resolves.toEqual({
      status: "confirmed",
      action: "unfollow",
    });
    expect(getKickAccountFollowState).toHaveBeenCalledWith("123", "viewer", "blame", {
      fresh: true,
    });
    expect(storage.removeLocalFollow).toHaveBeenCalledWith("stale-row");
  });

  it("confirms a different-ID unfollow as absent without removing the same-slug channel", async () => {
    getKickAccountFollowState.mockResolvedValue("not-followed");
    const unfollowTarget = {
      ...target,
      channelId: "kick-user-b",
      channelName: "sharedslug",
      displayName: "Target B",
    };
    const existingSameSlug = {
      ...target,
      id: "confirmed-row-a",
      channelId: "kick-user-a",
      channelName: "sharedslug",
      displayName: "Existing A",
      followedAt: "2026-07-04T03:00:00.000Z",
      source: "kick",
    } as LocalFollow;
    storage.getPendingFollowWritesByPlatform.mockReturnValueOnce([]).mockReturnValue([
      makePending({
        action: "unfollow",
        channelId: "kick-user-b",
        slug: "sharedslug",
      }),
    ]);
    storage.getActiveFollowsByPlatform.mockReturnValue([existingSameSlug]);
    getAllFollowedChannels.mockResolvedValue({
      status: "ok",
      channels: [
        {
          id: "kick-user-a",
          kickUserId: "kick-user-a",
          platform: "kick",
          username: "SHAREDSLUG",
          displayName: "Existing A",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        },
      ],
      canPruneAbsent: true,
    });
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      getKickAccountFollowState,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    const result = await service.enqueue(unfollowTarget, "unfollow");

    expect(result).toEqual({ status: "confirmed", action: "unfollow" });
    expect(storage.removeLocalFollow).not.toHaveBeenCalled();
    expect(storage.removePendingFollowWrite).toHaveBeenCalledWith({
      platform: "kick",
      channelId: "kick-user-b",
      slug: "sharedslug",
      action: "unfollow",
    });
  });

  it("treats HTTP 422 as indeterminate and confirms unfollow only after trusted absence", async () => {
    getKickAccountFollowState
      .mockResolvedValueOnce("unavailable")
      .mockResolvedValueOnce("not-followed");
    const confirmed = {
      ...target,
      id: "confirmed-row",
      followedAt: "2026-07-04T03:00:00.000Z",
      source: "kick",
    } as LocalFollow;
    storage.getPendingFollowWritesByPlatform
      .mockReturnValueOnce([])
      .mockReturnValue([makePending({ action: "unfollow" })]);
    storage.getActiveFollowsByPlatform.mockReturnValue([confirmed]);
    fetchKickWebApiMutationMock.mockResolvedValue({
      ok: false,
      kind: "unknown",
      status: 422,
      body: "{}",
      message: "Unprocessable Content",
    });
    getAllFollowedChannels
      .mockResolvedValueOnce({
        status: "ok",
        channels: [],
        canPruneAbsent: false,
      })
      .mockResolvedValueOnce({
        status: "ok",
        channels: [],
        canPruneAbsent: true,
      });
    const service = createKickFollowWriteService({
      storage,
      getKickAccountFollowState,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
      clearTimer,
    });

    const firstAttempt = await service.enqueue(target, "unfollow");

    expect(fetchKickWebApiMutationMock).toHaveBeenCalledWith(
      "DELETE",
      "/api/v2/channels/blame/follow"
    );
    expect(getKickAccountFollowState).toHaveBeenCalledTimes(1);
    expect(firstAttempt).toEqual(
      expect.objectContaining({
        status: "pending",
        write: expect.objectContaining({ lastError: "not-confirmed" }),
      })
    );
    expect(storage.removeLocalFollow).not.toHaveBeenCalled();
    expect(storage.removePendingFollowWrite).not.toHaveBeenCalled();

    if (firstAttempt.status !== "pending") throw new Error("Expected pending follow write");
    const confirmedAttempt = await service.process(firstAttempt.write, target);

    expect(getKickAccountFollowState).toHaveBeenCalledTimes(2);
    expect(confirmedAttempt).toEqual({ status: "confirmed", action: "unfollow" });
    expect(storage.removeLocalFollow).toHaveBeenCalledWith("confirmed-row");
  });

  it("publishes a sanitized auth-failed reason when a Kick write pauses for auth", async () => {
    writeKickAccountFollow.mockResolvedValue({
      status: "error",
      reason: "auth-failed",
    });
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });
    const onAccountWriteChanged = vi.fn();
    service.onAccountWriteChanged(onAccountWriteChanged);

    const result = await service.enqueue(target, "follow");

    expect(result.status).toBe("auth-paused");
    expect(storage.updatePendingFollowWriteState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "auth-paused",
        lastError: "auth-failed",
      })
    );
    expect(writeKickAccountFollow).toHaveBeenCalledTimes(1);
    expect(getAllFollowedChannels).not.toHaveBeenCalled();
    expect(onAccountWriteChanged).toHaveBeenCalledWith({
      status: "auth-paused",
      action: "follow",
      target: {
        platform: "kick",
        channelId: "411439",
        channelName: "blame",
      },
      activeFollows: [],
      reason: "auth-failed",
    });
  });

  it("marks a write failed when the retry window has expired", async () => {
    storage.getPendingFollowWritesByPlatform
      .mockReturnValueOnce([])
      .mockReturnValue([makePending({ expiresAt: "2026-07-04T03:00:00.000Z" })]);
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      now: () => new Date("2026-07-04T03:10:01.000Z"),
      setTimer,
    });
    const onAccountWriteChanged = vi.fn();
    service.onAccountWriteChanged(onAccountWriteChanged);

    const result = await service.enqueue(target, "follow");

    expect(result.status).toBe("failed");
    expect(storage.updatePendingFollowWriteState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastError: "retry-expired",
      })
    );
    expect(writeKickAccountFollow).not.toHaveBeenCalled();
    expect(onAccountWriteChanged).toHaveBeenCalledWith({
      status: "failed",
      action: "follow",
      target: {
        platform: "kick",
        channelId: "411439",
        channelName: "blame",
      },
      activeFollows: [],
      reason: "retry-expired",
    });
  });

  it("cancels a pending write by removing the persisted row", () => {
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
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

  it("clears a scheduled retry handle when the pending write is canceled", () => {
    const row = makePending({ nextAttemptAt: "2026-07-04T03:00:05.000Z" });
    storage.getPendingFollowWritesByPlatform.mockReturnValue([row]);
    setTimer.mockReturnValue("retry-handle");
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
      clearTimer,
    });
    service.resumePendingWrites();

    service.cancel(row);

    expect(clearTimer).toHaveBeenCalledWith("retry-handle");
  });

  it("clears the first scheduled handle before resuming the same pending write again", () => {
    const row = makePending({ nextAttemptAt: "2026-07-04T03:00:05.000Z" });
    storage.getPendingFollowWritesByPlatform.mockReturnValue([row]);
    setTimer.mockReturnValueOnce("first-handle").mockReturnValueOnce("second-handle");
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
      clearTimer,
    });

    service.resumePendingWrites();
    service.resumePendingWrites();

    expect(clearTimer).toHaveBeenCalledWith("first-handle");
    expect(setTimer).toHaveBeenCalledTimes(2);
  });

  it("rejects the opposite action while a same-channel pending write is active", async () => {
    storage.getPendingFollowWritesByPlatform.mockReturnValue([
      makePending({ action: "follow", channelId: "", slug: "BLAME" }),
    ]);
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      now: () => new Date("2026-07-04T03:00:00.000Z"),
      setTimer,
    });

    await expect(service.enqueue(target, "unfollow")).rejects.toThrow(
      "Cancel the pending Kick follow action"
    );

    expect(storage.addPendingFollowWrite).not.toHaveBeenCalled();
  });

  it("reuses same-action pending, retrying, and auth-paused writes without another attempt", async () => {
    const pending = makePending({ status: "pending", slug: "BLAME" });
    const retrying = makePending({
      id: 2,
      status: "retrying",
      channelId: "",
      slug: "BLAME",
    });
    const authPaused = makePending({ id: 3, status: "auth-paused", slug: "BLAME" });
    const events = vi.fn();
    const outcomes = [];

    for (const row of [pending, retrying, authPaused]) {
      storage.getPendingFollowWritesByPlatform.mockReturnValue([row]);
      const service = createKickFollowWriteService({
        storage,
        writeKickAccountFollow,
        now: () => new Date("2026-07-04T03:00:00.000Z"),
        setTimer,
      });
      service.onAccountWriteChanged(events);
      outcomes.push(await service.enqueue(target, "follow"));
    }

    expect(outcomes).toEqual([
      { status: "pending", write: pending },
      { status: "pending", write: retrying },
      { status: "auth-paused", write: authPaused },
    ]);
    expect(storage.addPendingFollowWrite).not.toHaveBeenCalled();
    expect(storage.updatePendingFollowWriteState).not.toHaveBeenCalled();
    expect(writeKickAccountFollow).not.toHaveBeenCalled();
    expect(getAllFollowedChannels).not.toHaveBeenCalled();
    expect(setTimer).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });

  it("restarts a failed same-action write with fresh attempt state before retrying Kick", async () => {
    getKickAccountFollowState.mockResolvedValue("followed");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T03:20:00.000Z"));
    try {
      const failed = makePending({
        status: "pending",
        nextAttemptAt: "2026-07-04T03:21:00.000Z",
        expiresAt: "2026-07-04T03:10:00.000Z",
        attemptCount: 4,
        lastError: "retry-expired",
      });
      const confirmed: LocalFollow = {
        ...target,
        id: "confirmed-row",
        followedAt: "2026-07-04T03:20:00.000Z",
        source: "kick",
      };
      let rows = [failed];
      let maximumRowCount = rows.length;
      let freshWrite: PendingFollowWrite | undefined;
      storage.getPendingFollowWritesByPlatform.mockImplementation(() => rows);
      storage.removePendingFollowWrite
        .mockImplementationOnce(() => {
          rows = [];
          return true;
        })
        .mockImplementationOnce(() => {
          rows = [];
          return true;
        });
      storage.addPendingFollowWrite.mockImplementationOnce((input) => {
        const now = input.now ?? new Date();
        freshWrite = makePending({
          id: 2,
          channelId: input.channelId,
          slug: input.slug,
          action: input.action,
          createdAt: now.toISOString(),
          attemptedAt: now.toISOString(),
          nextAttemptAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
          attemptCount: 0,
          lastError: null,
        });
        rows.push(freshWrite);
        maximumRowCount = Math.max(maximumRowCount, rows.length);
      });
      storage.getActiveFollowsByPlatform.mockReturnValue([confirmed]);
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
      const service = createKickFollowWriteService({
        storage,
        writeKickAccountFollow,
        getKickAccountFollowState,
        now: () => new Date(),
      });

      service.resumePendingWrites();
      expect(vi.getTimerCount()).toBe(1);
      failed.status = "failed";

      const result = await service.enqueue(target, "follow");

      expect(result).toEqual({ status: "confirmed", action: "follow", follow: confirmed });
      expect(storage.removePendingFollowWrite).toHaveBeenCalledTimes(2);
      expect(storage.addPendingFollowWrite).toHaveBeenCalledOnce();
      expect(storage.addPendingFollowWrite).toHaveBeenCalledWith({
        platform: "kick",
        channelId: "411439",
        slug: "blame",
        action: "follow",
        now: new Date("2026-07-04T03:20:00.000Z"),
      });
      expect(freshWrite).toEqual(
        expect.objectContaining({
          status: "pending",
          createdAt: "2026-07-04T03:20:00.000Z",
          expiresAt: "2026-07-04T03:30:00.000Z",
          attemptCount: 0,
          lastError: null,
        })
      );
      expect(maximumRowCount).toBe(1);
      expect(writeKickAccountFollow).toHaveBeenCalledOnce();
      expect(getKickAccountFollowState).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("schedules startup resume for non-failed pending writes", () => {
    storage.getPendingFollowWritesByPlatform.mockReturnValue([
      makePending({ id: 1, nextAttemptAt: "2026-07-04T03:00:05.000Z" }),
      makePending({ id: 2, status: "failed", nextAttemptAt: "2026-07-04T03:00:05.000Z" }),
    ]);
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
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

  it("clears an existing scheduled handle before retrying a pending write", async () => {
    const row = makePending({
      nextAttemptAt: "2026-07-04T03:20:05.000Z",
      expiresAt: "2026-07-04T03:30:00.000Z",
    });
    storage.getPendingFollowWritesByPlatform.mockReturnValue([row]);
    setTimer.mockReturnValue("retry-handle");
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      now: () => new Date("2026-07-04T03:20:00.000Z"),
      setTimer,
      clearTimer,
    });
    service.resumePendingWrites();

    await service.retry(row);

    expect(clearTimer).toHaveBeenCalledWith("retry-handle");
  });

  it("clears an existing scheduled handle when sync confirms the write", async () => {
    const row = makePending({
      nextAttemptAt: "2026-07-04T03:20:05.000Z",
      expiresAt: "2026-07-04T03:30:00.000Z",
    });
    const confirmed: LocalFollow = {
      ...target,
      id: "confirmed-row",
      followedAt: "2026-07-04T03:20:01.000Z",
      source: "kick",
    };
    storage.getPendingFollowWritesByPlatform.mockReturnValue([row]);
    storage.getActiveFollowsByPlatform.mockReturnValue([confirmed]);
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
    setTimer.mockReturnValue("retry-handle");
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      now: () => new Date("2026-07-04T03:20:00.000Z"),
      setTimer,
      clearTimer,
    });
    service.resumePendingWrites();

    await service.process(row, target);

    expect(clearTimer).toHaveBeenCalledWith("retry-handle");
  });

  it("clears an existing scheduled handle when the retry window expires", async () => {
    const row = makePending({
      nextAttemptAt: "2026-07-04T03:20:00.000Z",
      expiresAt: "2026-07-04T03:10:00.000Z",
    });
    storage.getPendingFollowWritesByPlatform.mockReturnValue([row]);
    setTimer.mockReturnValue("retry-handle");
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      now: () => new Date("2026-07-04T03:20:00.000Z"),
      setTimer,
      clearTimer,
    });
    service.resumePendingWrites();

    await service.process(row, target);

    expect(clearTimer).toHaveBeenCalledWith("retry-handle");
  });

  it("clears the prior handle before scheduling a replacement retry", async () => {
    const row = makePending({
      nextAttemptAt: "2026-07-04T03:20:05.000Z",
      expiresAt: "2026-07-04T03:30:00.000Z",
    });
    storage.getPendingFollowWritesByPlatform.mockReturnValue([row]);
    writeKickAccountFollow.mockResolvedValue({ status: "error", reason: "network-error" });
    setTimer.mockReturnValueOnce("prior-handle").mockReturnValueOnce("replacement-handle");
    const service = createKickFollowWriteService({
      storage,
      writeKickAccountFollow,
      now: () => new Date("2026-07-04T03:20:00.000Z"),
      setTimer,
      clearTimer,
    });
    service.resumePendingWrites();

    await service.process(row, target);

    expect(clearTimer).toHaveBeenCalledWith("prior-handle");
    expect(setTimer).toHaveBeenCalledTimes(2);
  });

  it("silently aborts a retry timer when reconciliation removed its persisted write", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T03:20:00.000Z"));
    try {
      const row = makePending({
        nextAttemptAt: "2026-07-04T03:20:00.000Z",
        expiresAt: "2026-07-04T03:30:00.000Z",
      });
      let persistedRows = [row];
      storage.getPendingFollowWritesByPlatform.mockImplementation(() => persistedRows);
      writeKickAccountFollow.mockResolvedValue({ status: "error", reason: "network-error" });
      const setRetryTimer = vi.fn((callback: () => void, delayMs: number) =>
        setTimeout(callback, delayMs)
      );
      const clearRetryTimer = vi.fn((handle: ReturnType<typeof setTimeout>) =>
        clearTimeout(handle)
      );
      const events = vi.fn();
      const service = createKickFollowWriteService({
        storage,
        writeKickAccountFollow,
        now: () => new Date(),
        setTimer: setRetryTimer,
        clearTimer: clearRetryTimer,
      });
      service.onAccountWriteChanged(events);

      await service.process(row, target);
      expect(setRetryTimer).toHaveBeenCalledOnce();
      writeKickAccountFollow.mockClear();
      getAllFollowedChannels.mockClear();
      events.mockClear();
      persistedRows = [];

      await vi.advanceTimersByTimeAsync(1000);

      expect(writeKickAccountFollow).not.toHaveBeenCalled();
      expect(getAllFollowedChannels).not.toHaveBeenCalled();
      expect(events).not.toHaveBeenCalled();
      service.cancel(row);
      expect(clearRetryTimer).not.toHaveBeenCalled();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
