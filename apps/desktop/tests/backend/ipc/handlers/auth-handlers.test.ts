import { describe, expect, it, vi } from "vitest";

import {
  KICK_STARTUP_FOLLOW_REFRESH_GRACE_MS,
  performTwitchDeviceCodeLogin,
  persistInitialAuthToken,
  reportKickFollowSyncFailure,
  shouldDeferKickStartupFollowRefresh,
  syncKickFollowsAfterLogin,
  syncTwitchFollowsAfterLogin,
} from "@/backend/ipc/handlers/auth-handlers";

describe("performTwitchDeviceCodeLogin", () => {
  it("runs the direct device flow and persists the authenticated Twitch account", async () => {
    const token = {
      accessToken: "at",
      refreshToken: "rt",
      authFlow: "device-code" as const,
    };
    const user = {
      id: "u1",
      login: "streamer",
      displayName: "Streamer",
      profileImageUrl: "https://example.com/avatar.png",
      createdAt: "2026-01-01T00:00:00Z",
      broadcasterType: "" as const,
    };
    const saveToken = vi.fn();
    const saveTwitchUser = vi.fn();
    const scheduleProactiveRefresh = vi.fn();
    const afterAuthenticated = vi.fn(async () => {});

    const result = await performTwitchDeviceCodeLogin({
      scopes: ["chat:read"],
      requestDeviceCode: vi.fn(async () => ({
        deviceCode: "dc",
        userCode: "ABCD-EFGH",
        verificationUri: "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH",
        expiresIn: 900,
        interval: 5,
      })),
      openVerificationWindow: vi.fn(async () => ({
        closed: new Promise<void>(() => undefined),
        close: vi.fn(),
        navigate: vi.fn(async () => undefined),
      })),
      pollForToken: vi.fn(async () => token),
      saveToken,
      scheduleProactiveRefresh,
      fetchCurrentUser: vi.fn(async () => user),
      saveTwitchUser,
      afterAuthenticated,
    });

    expect(saveToken).toHaveBeenCalledWith("twitch", token);
    expect(scheduleProactiveRefresh).toHaveBeenCalledTimes(1);
    expect(saveTwitchUser).toHaveBeenCalledWith(user);
    expect(afterAuthenticated).toHaveBeenCalledTimes(1);
    expect(result).toEqual(user);
  });

  it("closes the popup on token settlement before account refresh completes", async () => {
    const token = {
      accessToken: "at",
      refreshToken: "rt",
      authFlow: "device-code" as const,
    };
    const closePopup = vi.fn();
    const saveToken = vi.fn(() => {
      expect(closePopup).toHaveBeenCalledTimes(1);
    });
    let finishUserRefresh: (user: null) => void = () => undefined;
    const userRefresh = new Promise<null>((resolve) => {
      finishUserRefresh = resolve;
    });
    const afterAuthenticated = vi.fn(async () => {});

    const login = performTwitchDeviceCodeLogin({
      scopes: ["chat:read"],
      requestDeviceCode: vi.fn(async () => ({
        deviceCode: "dc",
        userCode: "ABCD-EFGH",
        verificationUri: "https://www.twitch.tv/activate?public=true&device-code=ABCD-EFGH",
        expiresIn: 900,
        interval: 5,
      })),
      openVerificationWindow: vi.fn(async () => ({
        closed: new Promise<void>(() => undefined),
        close: closePopup,
        navigate: vi.fn(async () => undefined),
      })),
      pollForToken: vi.fn(async () => token),
      saveToken,
      scheduleProactiveRefresh: vi.fn(),
      fetchCurrentUser: vi.fn(async () => await userRefresh),
      saveTwitchUser: vi.fn(),
      afterAuthenticated,
    });

    await vi.waitFor(() => {
      expect(closePopup).toHaveBeenCalledTimes(1);
      expect(saveToken).toHaveBeenCalledTimes(1);
    });
    expect(afterAuthenticated).not.toHaveBeenCalled();

    finishUserRefresh(null);
    await expect(login).resolves.toBeNull();
  });
});

describe("syncTwitchFollowsAfterLogin", () => {
  it("prunes absent Twitch rows only from a successfully fetched authoritative snapshot", async () => {
    const getFollows = vi.fn().mockResolvedValue([
      {
        id: "12345",
        platform: "twitch",
        username: "example_channel",
        displayName: "Example Channel",
        avatarUrl: "https://example.com/avatar.png",
      },
    ]);
    const upsertSyncedFollows = vi.fn().mockReturnValue({
      accountCount: 1,
      pendingCount: 0,
      addedCount: 0,
      removedCount: 2,
    });

    await expect(syncTwitchFollowsAfterLogin(getFollows, { upsertSyncedFollows })).resolves.toEqual(
      {
        status: "ok",
        count: 1,
        pendingCount: 0,
        addedCount: 0,
        removedCount: 2,
      }
    );
    expect(upsertSyncedFollows).toHaveBeenCalledWith(
      "twitch",
      [
        {
          platform: "twitch",
          channelId: "12345",
          channelName: "example_channel",
          displayName: "Example Channel",
          profileImage: "https://example.com/avatar.png",
        },
      ],
      { pruneAbsent: true }
    );
  });

  it("preserves prior Twitch rows when the authoritative fetch fails", async () => {
    const getFollows = vi.fn().mockRejectedValue(new Error("temporary Twitch failure"));
    const upsertSyncedFollows = vi.fn();

    await expect(syncTwitchFollowsAfterLogin(getFollows, { upsertSyncedFollows })).resolves.toEqual(
      {
        status: "error",
        reason: "twitch-follow-fetch-failed",
      }
    );
    expect(upsertSyncedFollows).not.toHaveBeenCalled();
  });
});

// Guards the A1 fix: a transient Cloudflare/Kasada/auth failure must NOT
// trigger an account-follows clear, because that would silently wipe the
// user's prior synced follow list. The "should-fix" reviewer rated this
// the highest-impact behavioral change in the diff (testing finding T1).
// Guards: successful Kick re-auth reconciles authoritative follows before resuming remaining writes.

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
          kickUserId: "421500",
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
          channelId: "421500",
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

  it("reconciles landed writes before resuming only the remaining auth-paused write", async () => {
    const calls: string[] = [];
    let pendingWrites = [
      { channelId: "already-landed", status: "auth-paused" },
      { channelId: "still-pending", status: "auth-paused" },
    ];
    const writeKickAccountFollow = vi.fn((channelId: string) => {
      calls.push(`write:${channelId}`);
    });
    const getFollows = vi.fn(async () => {
      calls.push("fetch-authoritative");
      return {
        status: "ok" as const,
        canPruneAbsent: true,
        channels: [],
      };
    });
    const upsertSyncedFollows = vi.fn(() => {
      calls.push("reconcile");
      pendingWrites = pendingWrites.filter((write) => write.channelId !== "already-landed");
      return { accountCount: 0, pendingCount: 1, addedCount: 0, removedCount: 0 };
    });
    const resumePendingWrites = vi.fn(() => {
      calls.push("resume");
      for (const write of pendingWrites) writeKickAccountFollow(write.channelId);
    });

    await syncKickFollowsAfterLogin(getFollows, { upsertSyncedFollows }, resumePendingWrites);

    expect(calls).toEqual(["fetch-authoritative", "reconcile", "resume", "write:still-pending"]);
    expect(writeKickAccountFollow).toHaveBeenCalledOnce();
    expect(writeKickAccountFollow).toHaveBeenCalledWith("still-pending");
    expect(writeKickAccountFollow).not.toHaveBeenCalledWith("already-landed");
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

// Guards: expected Kick credential rejection preserves the sync outcome without recurring warning noise.
// Guards: challenge and unknown Kick follow-sync failures remain visible at warning level.
describe("reportKickFollowSyncFailure", () => {
  it("demotes auth-failed to debug while retaining warnings for other failures", () => {
    const authFailed = { status: "error", reason: "auth-failed" } as const;
    const debug = vi.fn();
    const warn = vi.fn();

    expect(reportKickFollowSyncFailure(authFailed, { debug, warn })).toBe(authFailed);
    expect(debug).toHaveBeenCalledWith(
      "IPC:Auth",
      "Kick follow sync skipped; preserving prior account-source rows",
      { reason: "auth-failed" }
    );
    expect(warn).not.toHaveBeenCalled();

    for (const reason of ["cloudflare-challenge", "unexpected-response"]) {
      reportKickFollowSyncFailure({ status: "error", reason }, { debug, warn });
    }
    expect(warn).toHaveBeenCalledTimes(2);
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
// Guards: a new Kick credential invalidates the previous account follow snapshot before it can hydrate under another identity.
describe("persistInitialAuthToken", () => {
  it("invalidates the previous Kick follow snapshot when a new credential is persisted", () => {
    const saveToken = vi.fn();
    const invalidateKickAccountFollows = vi.fn();

    persistInitialAuthToken(
      "kick",
      { accessToken: "at" },
      { saveToken, invalidateKickAccountFollows }
    );

    expect(saveToken).toHaveBeenCalledWith("kick", { accessToken: "at" });
    expect(invalidateKickAccountFollows).toHaveBeenCalledOnce();
  });

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
