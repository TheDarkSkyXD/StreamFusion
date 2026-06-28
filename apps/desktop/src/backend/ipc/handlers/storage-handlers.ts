import { ipcMain } from "electron";

import type { LocalFollow, Platform, UserPreferences } from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { storageService } from "../../services/storage-service";
import { repairKickFollowSlugs } from "./kick-follow-repair";

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
  // Platform-tagged rows persist across logout/login (per the 2026-05-29
  // source-collapse: logout no longer deletes, just hides via `hasToken`).
  // This wrapper is now equivalent to `getActiveFollowsByPlatform` — the
  // function already returns guest follows when no token is present — but
  // it's kept as the seam for future "degraded mode" handling.
  const activeFollows = async (platform: Platform) => {
    const follows = storageService.getActiveFollowsByPlatform(platform);
    if (platform !== "kick" || follows.length === 0) {
      return follows;
    }

    const { kickClient } = await import("../../api/platforms/kick/kick-client");
    await repairKickFollowSlugs(kickClient, follows);

    return storageService.getActiveFollowsByPlatform("kick");
  };

  ipcMain.handle(IPC_CHANNELS.FOLLOWS_GET_ALL, async () => {
    return [...(await activeFollows("twitch")), ...(await activeFollows("kick"))];
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_GET_BY_PLATFORM,
    async (_event, { platform }: { platform: Platform }) => {
      return activeFollows(platform);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_ADD,
    (_event, { follow }: { follow: Omit<LocalFollow, "id" | "followedAt"> }) => {
      // Kick account rows must come from sync, not a local click. Until a
      // Kick-side follow write is confirmed, reject instead of creating a
      // source="kick" row that would look like a real account follow.
      if (follow.platform === "kick" && storageService.hasToken("kick")) {
        throw new Error(
          "Kick account follows must be confirmed by Kick before they can be shown as followed."
        );
      }
      const source = storageService.hasToken(follow.platform) ? follow.platform : "guest";
      return storageService.addLocalFollow(follow, source);
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
