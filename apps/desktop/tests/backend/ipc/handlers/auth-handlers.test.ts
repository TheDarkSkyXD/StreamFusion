import { describe, expect, it, vi } from "vitest";

import { syncKickFollowsAfterLogin } from "@/backend/ipc/handlers/auth-handlers";

// Guards the A1 fix: a transient Cloudflare/Kasada/auth failure must NOT
// trigger an account-follows clear, because that would silently wipe the
// user's prior synced follow list. The "should-fix" reviewer rated this
// the highest-impact behavioral change in the diff (testing finding T1).

describe("syncKickFollowsAfterLogin — A1 error-bail contract", () => {
  it("on getFollows error: returns the error AND does not touch storage", async () => {
    const replaceAccountFollows = vi.fn();
    const getFollows = vi.fn().mockResolvedValue({
      status: "error",
      reason: "cloudflare-challenge",
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      replaceAccountFollows,
    });

    expect(outcome).toEqual({ status: "error", reason: "cloudflare-challenge" });
    expect(replaceAccountFollows).not.toHaveBeenCalled();
  });

  it("on auth-failed (401/403): returns the error AND does not touch storage", async () => {
    // Cloudflare-challenge isn't the only error reason. Pin the contract for
    // auth-failed too so a future refactor that narrows the error-bail
    // condition (e.g. 'only bail on cloudflare-challenge') is caught.
    const replaceAccountFollows = vi.fn();
    const getFollows = vi.fn().mockResolvedValue({
      status: "error",
      reason: "auth-failed",
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      replaceAccountFollows,
    });

    expect(outcome).toEqual({ status: "error", reason: "auth-failed" });
    expect(replaceAccountFollows).not.toHaveBeenCalled();
  });

  it("on ok with channels: atomically replaces account follows with the imported rows", async () => {
    const replaceAccountFollows = vi.fn();
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
      replaceAccountFollows,
    });

    expect(outcome).toEqual({ status: "ok", count: 2 });
    expect(replaceAccountFollows).toHaveBeenCalledTimes(1);
    expect(replaceAccountFollows).toHaveBeenCalledWith("kick", [
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
    ]);
  });

  it("on ok with empty channels: still calls replaceAccountFollows so the prior rows are atomically cleared", async () => {
    // The Twitch-parity semantic: a successful sync that returns zero
    // follows IS authoritative — the user unfollowed everything. Distinct
    // from the error path where prior state is preserved.
    const replaceAccountFollows = vi.fn();
    const getFollows = vi.fn().mockResolvedValue({
      status: "ok",
      channels: [],
    });

    const outcome = await syncKickFollowsAfterLogin(getFollows, {
      replaceAccountFollows,
    });

    expect(outcome).toEqual({ status: "ok", count: 0 });
    expect(replaceAccountFollows).toHaveBeenCalledWith("kick", []);
  });
});
