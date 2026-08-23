import { type BrowserWindow, ipcMain } from "electron";
import { z } from "zod";

import { logger } from "@/backend/logging/logger";
import type {
  KickAccountFollowWriteSnapshot,
  KickAccountFollowWriteResult,
  LocalFollow,
  Platform,
  UserPreferences,
} from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { KickFollowWriteService } from "../../services/kick-follow-write-service";
import { storageService } from "../../services/storage-service";
import { isAllowedSender } from "../sender-origin";

const REJECTED_ACCOUNT_FOLLOW_WRITE: KickAccountFollowWriteResult = {
  status: "rejected",
  activeFollows: [],
  error: "Rejected: caller is not the application renderer.",
};

const INVALID_ACCOUNT_FOLLOW_WRITE: KickAccountFollowWriteResult = {
  status: "rejected",
  activeFollows: [],
  error: "Rejected: invalid Kick account follow request.",
};

function createAccountFollowWriteRequestSchema<TPlatform extends "kick" | "twitch">(
  platform: TPlatform
) {
  return z
    .object({
      action: z.enum(["follow", "unfollow"]),
      follow: z
        .object({
          platform: z.literal(platform),
          channelId: z.string().trim().min(1),
          channelName: z.string().trim().min(1),
          displayName: z.string(),
          profileImage: z.string(),
          lastSeen: z.string().optional(),
          isLive: z.boolean().optional(),
          notifications: z.boolean().optional(),
          source: z.enum(["guest", "twitch", "kick"]).optional(),
        })
        .strict(),
    })
    .strict();
}

const accountFollowWriteRequestSchema = z.union([
  createAccountFollowWriteRequestSchema("kick"),
  createAccountFollowWriteRequestSchema("twitch"),
]);

let followsMainWindow: BrowserWindow | undefined;
let removeAccountWriteListener: (() => void) | undefined;

export function attachKickFollowWriteService(service: KickFollowWriteService): void {
  if (!followsMainWindow) return;

  removeAccountWriteListener?.();
  removeAccountWriteListener = service.onAccountWriteChanged((event) => {
    try {
      const mainWindow = followsMainWindow;
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.FOLLOWS_ACCOUNT_WRITE_CHANGED, event);
      }
    } catch {
      logger.warn("IPC:Follows", "Could not forward account-write transition to renderer");
    }
  });
}

export function registerStorageHandlers(mainWindow?: BrowserWindow): void {
  followsMainWindow = mainWindow;

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

    const [{ kickClient }, { repairKickFollowSlugs }] = await Promise.all([
      import("../../api/platforms/kick/kick-client"),
      import("./kick-follow-repair"),
    ]);
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
      // Account rows must come from sync, not a local click. Reject instead of
      // creating a platform-source row before the remote write is confirmed.
      if (storageService.hasToken(follow.platform)) {
        const platformName = follow.platform === "kick" ? "Kick" : "Twitch";
        throw new Error(
          `${platformName} account follows must be confirmed by ${platformName} before they can be shown as followed.`
        );
      }
      return storageService.addLocalFollow(follow, "guest");
    }
  );

  ipcMain.handle(IPC_CHANNELS.FOLLOWS_REMOVE, (_event, { id }: { id: string }) => {
    return storageService.removeLocalFollow(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_GET_ACCOUNT_WRITES,
    (event): KickAccountFollowWriteSnapshot[] => {
      if (!isAllowedSender(event) || !storageService.hasToken("kick")) return [];

      return storageService.getPendingFollowWritesByPlatform("kick").map((write) => ({
        status: write.status,
        action: write.action,
        target: {
          platform: "kick",
          channelId: write.channelId,
          channelName: write.slug,
        },
        createdAt: write.createdAt,
        attemptedAt: write.attemptedAt,
        nextAttemptAt: write.nextAttemptAt,
        expiresAt: write.expiresAt,
        attemptCount: write.attemptCount,
        lastError: write.lastError,
      }));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_WRITE_ACCOUNT,
    async (event, request: unknown): Promise<KickAccountFollowWriteResult> => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:Follows", "FOLLOWS_WRITE_ACCOUNT rejected: disallowed sender origin");
        return REJECTED_ACCOUNT_FOLLOW_WRITE;
      }

      const parsed = accountFollowWriteRequestSchema.safeParse(request);
      if (!parsed.success) return INVALID_ACCOUNT_FOLLOW_WRITE;

      if (parsed.data.follow.platform === "twitch") {
        const { twitchFollowWriteService } =
          await import("../../services/twitch-follow-write-service");
        return twitchFollowWriteService.write(parsed.data.follow, parsed.data.action);
      }

      if (!storageService.hasToken("kick")) {
        throw new Error("Kick authentication is required to update account follows.");
      }

      const { kickFollowWriteService } = await import("../../services/kick-follow-write-service");
      attachKickFollowWriteService(kickFollowWriteService);
      const outcome = await kickFollowWriteService.enqueue(parsed.data.follow, parsed.data.action);
      return {
        status: outcome.status,
        activeFollows: storageService.getActiveFollowsByPlatform("kick"),
      };
    }
  );

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
