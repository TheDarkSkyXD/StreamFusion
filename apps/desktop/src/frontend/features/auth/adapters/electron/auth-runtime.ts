import type { AuthRuntime } from "../../capabilities/auth-runtime";

export const electronAuthRuntime: AuthRuntime = {
  auth: {
    getStatus: () => window.electronAPI.auth.getStatus(),
    refreshTwitchToken: () => window.electronAPI.auth.refreshTwitchToken(),
    refreshKickToken: () => window.electronAPI.auth.refreshKickToken(),
    onKickSessionExpired: (callback: Parameters<typeof window.electronAPI.auth.onKickSessionExpired>[0]) => window.electronAPI.auth.onKickSessionExpired(callback),
    onFollowsSynced: (callback: Parameters<typeof window.electronAPI.auth.onFollowsSynced>[0]) => window.electronAPI.auth.onFollowsSynced(callback),
    onTwitchAuthLost: (callback: Parameters<typeof window.electronAPI.auth.onTwitchAuthLost>[0]) => window.electronAPI.auth.onTwitchAuthLost(callback),
    syncFollows: (platform: "twitch" | "kick") => window.electronAPI.auth.syncFollows(platform),
    onDeviceCodeStatus: (callback: Parameters<typeof window.electronAPI.auth.onDeviceCodeStatus>[0]) => window.electronAPI.auth.onDeviceCodeStatus(callback),
    openTwitchLogin: () => window.electronAPI.auth.openTwitchLogin(),
    logoutTwitch: () => window.electronAPI.auth.logoutTwitch(),
    openKickLogin: () => window.electronAPI.auth.openKickLogin(),
    logoutKick: () => window.electronAPI.auth.logoutKick(),
  },
  follows: {
    getAll: () => window.electronAPI.follows.getAll(),
    add: (...args: Parameters<typeof window.electronAPI.follows.add>) => window.electronAPI.follows.add(...args),
    remove: (...args: Parameters<typeof window.electronAPI.follows.remove>) => window.electronAPI.follows.remove(...args),
    update: (...args: Parameters<typeof window.electronAPI.follows.update>) => window.electronAPI.follows.update(...args),
    isFollowing: (...args: Parameters<typeof window.electronAPI.follows.isFollowing>) => window.electronAPI.follows.isFollowing(...args),
  },
  preferences: {
    get: () => window.electronAPI.preferences.get(),
    update: (...args: Parameters<typeof window.electronAPI.preferences.update>) => window.electronAPI.preferences.update(...args),
  },
  streams: { getFollowed: (...args: Parameters<typeof window.electronAPI.streams.getFollowed>) => window.electronAPI.streams.getFollowed(...args) },
};
