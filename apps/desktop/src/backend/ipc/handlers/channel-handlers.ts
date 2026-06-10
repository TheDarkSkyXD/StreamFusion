import { ipcMain } from "electron";

import { logger } from "@/backend/logging/logger";
import type { Platform } from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { storageService } from "../../services/storage-service";

export function registerChannelHandlers(): void {
  /**
   * Get channel by ID
   */
  ipcMain.handle(
    IPC_CHANNELS.CHANNELS_GET_BY_ID,
    async (
      _event,
      params: {
        platform: Platform;
        channelId: string;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        let channel = null;

        if (params.platform === "twitch") {
          const channels = await twitchClient.getChannelsById([params.channelId]);
          channel = channels[0] || null;
        } else if (params.platform === "kick") {
          // Kick uses slug, but we can try to fetch by ID
          channel = await kickClient.getChannel(params.channelId);
        }

        return { success: true, data: channel };
      } catch (error) {
        logger.error("IPC:Channel", "Failed to get channel by ID", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch channel",
        };
      }
    }
  );

  /**
   * Get channel by username/slug
   */
  ipcMain.handle(
    IPC_CHANNELS.CHANNELS_GET_BY_USERNAME,
    async (
      _event,
      params: {
        platform: Platform;
        username: string;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        let channel = null;

        if (params.platform === "twitch") {
          // Use GQL (no auth needed) for channel lookup by login
          channel = await twitchClient.getChannelByLogin(params.username);
        } else if (params.platform === "kick") {
          channel = await kickClient.getChannel(params.username);
        }

        return { success: true, data: channel };
      } catch (error) {
        logger.error("IPC:Channel", "Failed to get channel by username", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch channel",
        };
      }
    }
  );

  /**
   * Get followed channels (remote)
   */
  ipcMain.handle(
    IPC_CHANNELS.CHANNELS_GET_FOLLOWED,
    async (
      _event,
      params: {
        platform: Platform;
      }
    ) => {
      const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");

      try {
        let channels: any[] = [];

        if (params.platform === "twitch") {
          if (twitchClient.isAuthenticated()) {
            // Get all followed channels
            channels = await twitchClient.getAllFollowedChannels();
          }
        } else if (params.platform === "kick") {
          channels = storageService.getActiveFollowsByPlatform("kick").map((follow) => ({
            id: follow.channelId,
            platform: "kick",
            username: follow.channelName,
            displayName: follow.displayName || follow.channelName,
            avatarUrl: follow.profileImage || "",
            isLive: false,
            isVerified: false,
            isPartner: false,
          }));
        }

        return { success: true, data: channels };
      } catch (error) {
        logger.error("IPC:Channel", "Failed to get followed channels", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to fetch followed channels",
        };
      }
    }
  );
}
