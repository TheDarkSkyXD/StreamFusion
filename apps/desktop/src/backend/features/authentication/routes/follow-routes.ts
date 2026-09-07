import { z } from "zod";

import { authenticationRepository } from "@backend/features/authentication/data/authentication-repository";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";
import { isAllowedSender } from "@backend/ipc/sender-origin";
import { trustedIpcMain as ipcMain } from "@backend/ipc/trusted-ipc-main";
import { logger } from "@backend/logging/logger";
import { registerLoadedFeatureCleanup } from "@backend/startup/loaded-feature-cleanup";
import type {
  KickAccountFollowWriteResult,
  KickAccountFollowWriteSnapshot,
  LocalFollow,
} from "@shared/auth-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import { Platform } from "@streamfusion/core/platform";
import type { KickFollowWriteService } from "../adapters/kick/kick-follow-write-service";

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
  return z.strictObject({
    action: z.enum(["follow", "unfollow"]),
    follow: z.strictObject({
      platform: z.literal(platform),
      channelId: z.string().trim().min(1),
      channelName: z.string().trim().min(1),
      displayName: z.string(),
      profileImage: z.string(),
      lastSeen: z.string().optional(),
      isLive: z.boolean().optional(),
      notifications: z.boolean().optional(),
      source: z.enum(["guest", "twitch", "kick"]).optional(),
    }),
  });
}

const accountFollowWriteRequestSchema = z.union([
  createAccountFollowWriteRequestSchema("kick"),
  createAccountFollowWriteRequestSchema("twitch"),
]);

let followsRenderer: MainRendererPort | undefined;
let removeAccountWriteListener: (() => void) | undefined;
let accountWriteCleanupRegistered = false;

export function attachKickFollowWriteService(
  service: KickFollowWriteService,
  renderer = followsRenderer
): void {
  if (!renderer) return;
  followsRenderer = renderer;
  removeAccountWriteListener?.();
  removeAccountWriteListener = service.onAccountWriteChanged((event) => {
    if (!renderer.send(IPC_CHANNELS.FOLLOWS_ACCOUNT_WRITE_CHANGED, event)) {
      logger.warn("IPC:Follows", "Could not forward account-write transition to renderer");
    }
  });
  if (!accountWriteCleanupRegistered) {
    accountWriteCleanupRegistered = true;
    registerLoadedFeatureCleanup("authentication:account-write-events", () => {
      removeAccountWriteListener?.();
      removeAccountWriteListener = undefined;
      followsRenderer = undefined;
      accountWriteCleanupRegistered = false;
    });
  }
}

/** Registers follow reads and authenticated account-write commands for Authentication. */
export function registerFollowRoutes(renderer?: MainRendererPort): void {
  followsRenderer = renderer;
  const activeFollows = (platform: Platform) =>
    authenticationRepository.getActiveFollowsByPlatform(platform);
  ipcMain.handle(IPC_CHANNELS.FOLLOWS_GET_ALL, () => [
    ...activeFollows("twitch"),
    ...activeFollows("kick"),
  ]);
  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_GET_BY_PLATFORM,
    (_event, { platform }: { platform: Platform }) => activeFollows(platform)
  );
  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_ADD,
    (_event, { follow }: { follow: Omit<LocalFollow, "id" | "followedAt"> }) => {
      if (authenticationRepository.hasToken(follow.platform)) {
        const platformName = follow.platform === "kick" ? "Kick" : "Twitch";
        throw new Error(
          `${platformName} account follows must be confirmed by ${platformName} before they can be shown as followed.`
        );
      }
      return authenticationRepository.addLocalFollow(follow, "guest");
    }
  );
  ipcMain.handle(IPC_CHANNELS.FOLLOWS_REMOVE, (_event, { id }: { id: string }) =>
    authenticationRepository.removeLocalFollow(id)
  );
  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_GET_ACCOUNT_WRITES,
    (event): KickAccountFollowWriteSnapshot[] => {
      if (!isAllowedSender(event) || !authenticationRepository.hasToken("kick")) return [];
      return authenticationRepository.getPendingFollowWritesByPlatform("kick").map((write) => ({
        status: write.status,
        action: write.action,
        target: { platform: "kick", channelId: write.channelId, channelName: write.slug },
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
          await import("@backend/features/authentication/adapters/twitch/twitch-follow-write-service");
        return twitchFollowWriteService.write(parsed.data.follow, parsed.data.action);
      }
      if (!authenticationRepository.hasToken("kick")) {
        throw new Error("Kick authentication is required to update account follows.");
      }
      const { kickFollowWriteService } =
        await import("@backend/features/authentication/adapters/kick/kick-follow-write-service");
      attachKickFollowWriteService(kickFollowWriteService);
      const outcome = await kickFollowWriteService.enqueue(parsed.data.follow, parsed.data.action);
      return {
        status: outcome.status,
        activeFollows: authenticationRepository.getActiveFollowsByPlatform("kick"),
      };
    }
  );
  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_UPDATE,
    (_event, { id, updates }: { id: string; updates: Partial<LocalFollow> }) =>
      authenticationRepository.updateLocalFollow(id, updates)
  );
  ipcMain.handle(
    IPC_CHANNELS.FOLLOWS_IS_FOLLOWING,
    (_event, { platform, channelId }: { platform: Platform; channelId: string }) =>
      authenticationRepository.isFollowing(platform, channelId)
  );
  ipcMain.handle(IPC_CHANNELS.FOLLOWS_IMPORT, (_event, { follows }: { follows: LocalFollow[] }) =>
    authenticationRepository.importLocalFollows(follows)
  );
  ipcMain.handle(IPC_CHANNELS.FOLLOWS_CLEAR, () => authenticationRepository.clearLocalFollows());
}
