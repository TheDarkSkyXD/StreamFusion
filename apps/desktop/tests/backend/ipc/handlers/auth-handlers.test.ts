import { describe, expect, it, vi } from "vitest";

import {
  KICK_STARTUP_FOLLOW_REFRESH_GRACE_MS,
  persistInitialAuthToken,
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

  it("on trusted ok with channels: upserts Kick follows and prunes absent rows", async () => {
    const upsertSyncedFollows = vi
      .fn()
      .mockReturnValue({ accountCount: 2, pendingCount: 0, addedCount: 2, removedCount: 0 });
    const getFollows = vi.fn().mockResolvedValue({
      status: "ok",
      canPruneAbsent: true,
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
      { pruneAbsent: true }
    );
  });

  it("on trusted ok with empty channels: prunes absent Kick follows", async () => {
    // A trusted endpoint returning an empty list means the account follows no
    // Kick channels, so stale account-source rows may be pruned.
    const upsertSyncedFollows = vi
      .fn()
      .mockReturnValue({ accountCount: 0, pendingCount: 0, addedCount: 0, removedCount: 0 });
    const getFollows = vi.fn().mockResolvedValue({
      status: "ok",
      canPruneAbsent: true,
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
    expect(upsertSyncedFollows).toHaveBeenCalledWith("kick", [], { pruneAbsent: true });
  });

  it("on uncertain ok with empty channels: preserves absent Kick follows", async () => {
    // A fallback scrape with zero results is ambiguous: it could mean a true
    // empty account, auth loss, slow render, or a Kick layout change. Preserve.
    const upsertSyncedFollows = vi
      .fn()
      .mockReturnValue({ accountCount: 3, pendingCount: 0, addedCount: 0, removedCount: 0 });
    const getFollows = vi.fn().mockResolvedValue({
      status: "ok",
      canPruneAbsent: false,
      channels: [],
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      upsertSyncedFollows,
    });

    expect(outcome).toEqual({
      status: "ok",
      count: 3,
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
      canPruneAbsent: true,
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
      canPruneAbsent: true,
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

// Guards: callback scope metadata is stored as observed, never upgraded to an
// unverified canonical grant. Official introspection is the scope truth source.
// Guards: Twitch token persistence remains unchanged by Kick-specific normalization.
describe("persistInitialAuthToken", () => {
  it("does not synthesize a Kick grant when the callback omits scope", () => {
    const saveToken = vi.fn();

    persistInitialAuthToken("kick", { accessToken: "at" }, { saveToken });

    expect(saveToken).toHaveBeenCalledWith("kick", { accessToken: "at" });
  });

  it.each([
    ["explicitly empty", []],
    ["explicitly incomplete", ["user:read", "channel:read"]],
  ])("persists an %s Kick callback grant without pretending it is complete", (_label, scope) => {
    const saveToken = vi.fn();
    const token = { accessToken: "at", scope };

    expect(persistInitialAuthToken("kick", token, { saveToken })).toBe(token);
    expect(saveToken).toHaveBeenCalledWith("kick", token);
  });

  it("persists Twitch tokens unchanged", () => {
    const saveToken = vi.fn();
    const token = { accessToken: "twitch-at" };

    expect(persistInitialAuthToken("twitch", token, { saveToken })).toBe(token);
    expect(saveToken).toHaveBeenCalledWith("twitch", token);
  });
});
