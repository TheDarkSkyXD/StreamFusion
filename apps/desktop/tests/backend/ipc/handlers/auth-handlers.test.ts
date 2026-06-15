import { describe, expect, it, vi } from "vitest";

import {
  KICK_STARTUP_FOLLOW_REFRESH_GRACE_MS,
  shouldDeferKickStartupFollowRefresh,
  syncKickFollowsAfterLogin,
} from "@/backend/ipc/handlers/auth-handlers";

// Guards the A1 fix: a transient Cloudflare/Kasada/auth failure must NOT
// trigger an account-follows clear, because that would silently wipe the
// user's prior synced follow list. The "should-fix" reviewer rated this
// the highest-impact behavioral change in the diff (testing finding T1).

describe("syncKickFollowsAfterLogin — A1 error-bail contract", () => {
  it("on getFollows error: returns the error AND does not touch storage", async () => {
    const upsertSyncedFollows = vi.fn();
    const getFollows = vi.fn().mockResolvedValue({
      status: "error",
      reason: "cloudflare-challenge",
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      upsertSyncedFollows,
    });

    expect(outcome).toEqual({ status: "error", reason: "cloudflare-challenge" });
    expect(upsertSyncedFollows).not.toHaveBeenCalled();
  });

  it("on auth-failed (401/403): returns the error AND does not touch storage", async () => {
    // Cloudflare-challenge isn't the only error reason. Pin the contract for
    // auth-failed too so a future refactor that narrows the error-bail
    // condition (e.g. 'only bail on cloudflare-challenge') is caught.
    const upsertSyncedFollows = vi.fn();
    const getFollows = vi.fn().mockResolvedValue({
      status: "error",
      reason: "auth-failed",
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      upsertSyncedFollows,
    });

    expect(outcome).toEqual({ status: "error", reason: "auth-failed" });
    expect(upsertSyncedFollows).not.toHaveBeenCalled();
  });

  it("on ok with channels: upserts Kick follows without pruning absent rows; surfaces pendingCount", async () => {
    const upsertSyncedFollows = vi
      .fn()
      .mockReturnValue({ accountCount: 2, pendingCount: 0, addedCount: 2, removedCount: 0 });
    const getFollows = vi.fn().mockResolvedValue({
      status: "ok",
      channels: [
        {
          id: "411439",
          platform: "kick",
          username: "summit1g",
          displayName: "Summit1G",
          avatarUrl: "https://example.com/summit.jpg",
          bannerUrl: undefined,
          bio: undefined,
          isLive: false,
          isVerified: false,
          isPartner: false,
        },
        {
          id: "",
          platform: "kick",
          username: "chickenandy",
          displayName: "ChickenAndy",
          avatarUrl: "https://example.com/chicken.jpg",
          bannerUrl: undefined,
          bio: undefined,
          isLive: true,
          isVerified: false,
          isPartner: false,
        },
      ],
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      upsertSyncedFollows,
    });

    expect(outcome).toEqual({
      status: "ok",
      count: 2,
      pendingCount: 0,
      addedCount: 2,
      removedCount: 0,
    });
    expect(upsertSyncedFollows).toHaveBeenCalledTimes(1);
    expect(upsertSyncedFollows).toHaveBeenCalledWith(
      "kick",
      [
        expect.objectContaining({
          platform: "kick",
          channelId: "411439",
          channelName: "summit1g",
          displayName: "Summit1G",
          profileImage: "https://example.com/summit.jpg",
        }),
        expect.objectContaining({
          platform: "kick",
          channelId: "",
          channelName: "chickenandy",
          displayName: "ChickenAndy",
          profileImage: "https://example.com/chicken.jpg",
        }),
      ],
      { pruneAbsent: false }
    );
  });

  it("on ok with empty channels: still uses the additive Kick sync policy", async () => {
    // Kick's DOM scrape can be partial, so even an empty ok payload must not
    // request pruning. The scraper normally returns an error for zero channels;
    // this pins the lower-level sync policy.
    const upsertSyncedFollows = vi
      .fn()
      .mockReturnValue({ accountCount: 0, pendingCount: 0, addedCount: 0, removedCount: 0 });
    const getFollows = vi.fn().mockResolvedValue({
      status: "ok",
      channels: [],
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      upsertSyncedFollows,
    });

    expect(outcome).toEqual({
      status: "ok",
      count: 0,
      pendingCount: 0,
      addedCount: 0,
      removedCount: 0,
    });
    expect(upsertSyncedFollows).toHaveBeenCalledWith("kick", [], { pruneAbsent: false });
  });

  it("surfaces pendingCount from the storage call so the AUTH_FOLLOWS_SYNCED IPC can drive the U8 banner", async () => {
    // Reconciliation reported 1 still-unconfirmed pending write — the IPC
    // payload needs to carry that through for the banner to surface it.
    const upsertSyncedFollows = vi
      .fn()
      .mockReturnValue({ accountCount: 3, pendingCount: 1, addedCount: 0, removedCount: 0 });
    const getFollows = vi.fn().mockResolvedValue({
      status: "ok",
      channels: [],
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      upsertSyncedFollows,
    });

    expect(outcome).toEqual({
      status: "ok",
      count: 3,
      pendingCount: 1,
      addedCount: 0,
      removedCount: 0,
    });
  });

  it("surfaces addedCount/removedCount from the storage call so the renderer can skip cache invalidation on no-op syncs", async () => {
    // The renderer-gate contract: the IPC payload carries the diff through so
    // the renderer only refetches the followed-channels query when something
    // actually changed. This is what stops periodic background syncs from
    // disrupting the sidebar.
    const upsertSyncedFollows = vi
      .fn()
      .mockReturnValue({ accountCount: 5, pendingCount: 0, addedCount: 1, removedCount: 2 });
    const getFollows = vi.fn().mockResolvedValue({
      status: "ok",
      channels: [],
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      upsertSyncedFollows,
    });

    expect(outcome).toEqual({
      status: "ok",
      count: 5,
      pendingCount: 0,
      addedCount: 1,
      removedCount: 2,
    });
  });
});

describe("shouldDeferKickStartupFollowRefresh", () => {
  it("defers Kick focus refresh during the startup grace period", () => {
    expect(
      shouldDeferKickStartupFollowRefresh(
        "kick",
        "focus",
        1000 + KICK_STARTUP_FOLLOW_REFRESH_GRACE_MS - 1,
        1000
      )
    ).toBe(true);
  });

  it("does not defer Twitch, interval refreshes, or Kick focus after the grace period", () => {
    expect(shouldDeferKickStartupFollowRefresh("twitch", "focus", 1000, 0)).toBe(false);
    expect(shouldDeferKickStartupFollowRefresh("kick", "interval", 1000, 0)).toBe(false);
    expect(
      shouldDeferKickStartupFollowRefresh(
        "kick",
        "focus",
        1000 + KICK_STARTUP_FOLLOW_REFRESH_GRACE_MS,
        1000
      )
    ).toBe(false);
  });
});
