import { ipcMain } from "electron";

import { logger } from "@/backend/logging/logger";
import type { KickUser, Platform } from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { UnifiedChannel } from "../../api/unified/platform-types";
import { storageService } from "../../services/storage-service";
import { repairKickFollowSlugs } from "./kick-follow-repair";

function enrichOwnKickChannel(
  channel: UnifiedChannel | null,
  requestedUsername: string,
  kickUser: KickUser | null
): UnifiedChannel | null {
  if (!channel || !kickUser) return channel;

  const requested = requestedUsername.toLowerCase();
  const channelUsername = channel.username.toLowerCase();
  const authSlug = kickUser.slug.toLowerCase();
  const authUsername = kickUser.username.toLowerCase();
  const isOwnChannel =
    requested === authSlug ||
    requested === authUsername ||
    channelUsername === authSlug ||
    channelUsername === authUsername ||
    channel.kickUserId === kickUser.id.toString();

  if (!isOwnChannel) return channel;

  return {
    ...channel,
    username: kickUser.slug || channel.username,
    displayName: kickUser.username || channel.displayName,
    avatarUrl: kickUser.profilePic || channel.avatarUrl,
    bio: channel.bio || kickUser.bio,
    isVerified: channel.isVerified || kickUser.verified,
  };
}

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
          channel = enrichOwnKickChannel(channel, params.username, storageService.getKickUser());
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
      const { kickClient } = await import("../../api/platforms/kick/kick-client");

      try {
        let channels: any[] = [];

        if (params.platform === "twitch") {
          if (twitchClient.isAuthenticated()) {
            // Get all followed channels
            channels = await twitchClient.getAllFollowedChannels();
          }
        } else if (params.platform === "kick") {
          const follows = storageService.getActiveFollowsByPlatform("kick");
          const repairedChannels = await repairKickFollowSlugs(kickClient, follows);

          channels = follows.map((follow) => {
            const current = repairedChannels.get(follow.id);

            return {
              id: follow.channelId,
              platform: "kick",
              username: current?.username || follow.channelName,
              displayName: current?.displayName || follow.displayName || follow.channelName,
              avatarUrl: current?.avatarUrl || follow.profileImage || "",
              isLive: current?.isLive || false,
              isVerified: current?.isVerified || false,
              isPartner: current?.isPartner || false,
            };
          });
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
