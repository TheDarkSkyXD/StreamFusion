import { ipcMain } from "electron";

import type { LocalFollow, Platform, UserPreferences } from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { storageService } from "../../services/storage-service";

export function registerStorageHandlers(): void {
  // ========== Generic Storage (backward compatibility) ==========
  ipcMain.handle(IPC_CHANNELS.STORE_GET, (_event, { key }: { key: string }) => {
    return storageService.get(key as keyof typeof storageService.get);
  });

  ipcMain.handle(
    IPC_CHANNELS.STORE_SET,
    (_event, { key, value }: { key: string; value: unknown }) => {
      storageService.set(key as any, value as any);
    }
  );

  ipcMain.handle(IPC_CHANNELS.STORE_DELETE, (_event, { key }: { key: string }) => {
    storageService.delete(key as any);
  });

  // ========== Local Follows ==========
  // Account-source rows linger in the DB after a session ends silently
  // (token revoked at runtime — onTwitchAuthLost / onKickSessionExpired
  // path doesn't call clearAccountFollows). Treat "no token in storage"
  // as the source-of-truth for "this platform is not connected" and fall
  // back to guest follows so a hydrate() during degraded mode doesn't
  // return the now-revoked account's follows.
  const activeFollows = (platform: Platform) => {
    if (!storageService.hasToken(platform)) {
      return storageService.getGuestFollowsByPlatform(platform);
    }
    return storageService.getActiveFollowsByPlatform(platform);
  };

  ipcMain.handle(IPC_CHANNELS.FOLLOWS_GET_ALL, () => {
    return [...activeFollows("twitch"), ...activeFollows("kick")];
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_GET_BY_PLATFORM,
    (_event, { platform }: { platform: Platform }) => {
      return activeFollows(platform);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_ADD,
    (_event, { follow }: { follow: Omit<LocalFollow, "id" | "followedAt"> }) => {
      return storageService.addLocalFollow(follow);
    }
  );

  ipcMain.handle(IPC_CHANNELS.FOLLOWS_REMOVE, (_event, { id }: { id: string }) => {
    return storageService.removeLocalFollow(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_UPDATE,
    (_event, { id, updates }: { id: string; updates: Partial<LocalFollow> }) => {
      return storageService.updateLocalFollow(id, updates);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_IS_FOLLOWING,
    (_event, { platform, channelId }: { platform: Platform; channelId: string }) => {
      return storageService.isFollowing(platform, channelId);
    }
  );

  ipcMain.handle(IPC_CHANNELS.FOLLOWS_IMPORT, (_event, { follows }: { follows: LocalFollow[] }) => {
    return storageService.importLocalFollows(follows);
  });

  ipcMain.handle(IPC_CHANNELS.FOLLOWS_CLEAR, () => {
    storageService.clearLocalFollows();
  });

  // ========== User Preferences ==========
  ipcMain.handle(IPC_CHANNELS.PREFERENCES_GET, () => {
    return storageService.getPreferences();
  });

  ipcMain.handle(
    IPC_CHANNELS.PREFERENCES_UPDATE,
    (_event, { updates }: { updates: Partial<UserPreferences> }) => {
      return storageService.updatePreferences(updates);
    }
  );

  ipcMain.handle(IPC_CHANNELS.PREFERENCES_RESET, () => {
    storageService.resetPreferences();
  });
}
