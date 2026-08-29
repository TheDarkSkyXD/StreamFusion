import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedChannel } from "@shared/platform-types";
import type { LocalFollow } from "@shared/auth-types";
import type { AuthStatus } from "@shared/ipc-channels";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";

import { installElectronAPIMock } from "../test-utils";

const initialAuthState = useAuthStore.getState();

const originalGuestRow: LocalFollow = {
  id: "guest-original",
  platform: "kick",
  channelId: "guest-legacy-id",
  channelName: "summit1g",
  displayName: "Summit1G guest",
  profileImage: "guest.webp",
  followedAt: "2026-08-01T00:00:00.000Z",
  source: "guest",
};

const remoteRow: LocalFollow = {
  id: "kick-confirmed",
  platform: "kick",
  channelId: "411439",
  channelName: "SUMMIT1G",
  displayName: "Summit1G account",
  profileImage: "account.webp",
  followedAt: "2026-08-02T00:00:00.000Z",
  source: "kick",
};

const transientGuestChannel: UnifiedChannel = {
  id: "transient-id",
  platform: "kick",
  username: "temporaryguestfollow",
  displayName: "Temporary Guest Follow",
  avatarUrl: "temporary.webp",
  isLive: false,
  isVerified: false,
  isPartner: false,
};

function channelFromRow(row: LocalFollow): UnifiedChannel {
  return {
    id: row.channelId,
    platform: row.platform,
    username: row.channelName,
    displayName: row.displayName,
    avatarUrl: row.profileImage,
    bannerUrl: "",
    bio: "",
    isLive: false,
    isVerified: false,
    isPartner: false,
  };
}

// Guards: Kick guest follows must remain a separate persistent mode across sign-in/account hydration/sign-out, even when a remote row has the same slug with different casing and identity.
// Guards: loginKick itself must switch the renderer to the account collection before returning, without deleting or exposing the guest collection.
describe("Kick guest/account follow mode preservation", () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      ...initialAuthState,
      kickUser: null,
      kickConnected: false,
      kickLoading: false,
      twitchUser: null,
      twitchConnected: false,
      isGuest: true,
    });
    useFollowStore.setState({
      localFollows: [],
      sourceByKey: new Map(),
      pendingAccountActions: [],
      isHydrated: false,
    });
  });

  afterEach(() => {
    localStorage.clear();
    useAuthStore.setState(initialAuthState);
    useFollowStore.setState({
      localFollows: [],
      sourceByKey: new Map(),
      pendingAccountActions: [],
      isHydrated: false,
    });
  });

  it("keeps guest writes local and restores the exact guest list after account mode", async () => {
    const api = installElectronAPIMock();
    let kickSignedIn = false;
    let guestRows = [originalGuestRow];

    api.follows.getAll = vi.fn(async () =>
      structuredClone(kickSignedIn ? [remoteRow] : guestRows)
    );
    api.follows.add = vi.fn(async (follow: Omit<LocalFollow, "id" | "followedAt">) => {
      const added: LocalFollow = {
        ...follow,
        id: "guest-transient",
        followedAt: "2026-08-03T00:00:00.000Z",
        source: "guest",
      };
      guestRows = [...guestRows, added];
      return added;
    });
    api.follows.remove = vi.fn(async (id: string) => {
      guestRows = guestRows.filter((row) => row.id !== id);
      return true;
    });
    api.follows.writeAccount = vi.fn();

    const authStatus = (): AuthStatus => ({
      twitch: { connected: false, user: null, hasToken: false, isExpired: false },
      kick: {
        connected: kickSignedIn,
        user: kickSignedIn
          ? ({ id: 1, username: "viewer", slug: "viewer" } as AuthStatus["kick"]["user"])
          : null,
        hasToken: kickSignedIn,
        isExpired: false,
      },
      isGuest: !kickSignedIn,
    });
    api.auth.openKickLogin = vi.fn(async () => {
      kickSignedIn = true;
    });
    api.auth.getStatus = vi.fn(async () => authStatus());
    api.auth.logoutKick = vi.fn(async () => {
      kickSignedIn = false;
      return { success: true };
    });

    await useFollowStore.getState().hydrate();
    expect(useFollowStore.getState().localFollows).toEqual([channelFromRow(originalGuestRow)]);

    await useFollowStore.getState().followChannel(transientGuestChannel);
    await useFollowStore.getState().unfollowChannel(transientGuestChannel);
    expect(api.follows.add).toHaveBeenCalledTimes(1);
    expect(api.follows.remove).toHaveBeenCalledTimes(1);
    expect(api.follows.writeAccount).not.toHaveBeenCalled();

    await useAuthStore.getState().loginKick();
    expect(useAuthStore.getState().kickConnected).toBe(true);
    expect(useFollowStore.getState().localFollows).toEqual([channelFromRow(remoteRow)]);
    expect(useFollowStore.getState().getFollowSource(channelFromRow(remoteRow))).toBe("kick");
    expect(api.follows.add).toHaveBeenCalledTimes(1);
    expect(api.follows.remove).toHaveBeenCalledTimes(1);
    expect(api.follows.writeAccount).not.toHaveBeenCalled();

    await useAuthStore.getState().logoutKick();
    expect(useAuthStore.getState().kickConnected).toBe(false);
    expect(useFollowStore.getState().localFollows).toEqual([channelFromRow(originalGuestRow)]);
    expect(useFollowStore.getState().getFollowSource(channelFromRow(originalGuestRow))).toBe(
      "guest"
    );
    expect(api.follows.writeAccount).not.toHaveBeenCalled();
  });
});
