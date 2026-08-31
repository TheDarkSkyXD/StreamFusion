import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";

import { logger } from "@backend/logging/logger";
import { dedupeChannelsByIdentity } from "@/lib/id-utils";
import {
  firstValidKickBroadcasterUserId,
  getKickBroadcasterUserIdFromAvatar,
} from "@/lib/kick-channel-identity";
import type { KickUser, Platform } from "../../../shared/auth-types";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { UnifiedChannel } from "../../../shared/platform-types";
import { storageService } from "../../services/storage-service";
import { buildKickFollowedChannelSnapshot } from "../../services/kick-follow-identity-service";

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

function refreshStoredFollowFromResolvedChannel(
  channel: UnifiedChannel,
  requestedUsername: string
): void {
  const requested = requestedUsername.trim().toLowerCase();
  const canonicalChannelId =
    channel.platform === "kick"
      ? (firstValidKickBroadcasterUserId(channel.kickUserId, channel.id) ?? channel.id)
      : channel.id;
  const identityIds = new Set([channel.id, canonicalChannelId, channel.kickUserId].filter(Boolean));
  const follow = storageService.getActiveFollowsByPlatform(channel.platform).find((candidate) => {
    if (candidate.channelName.trim().toLowerCase() === requested) return true;
    if (identityIds.has(candidate.channelId)) return true;
    if (channel.platform !== "kick") return false;
    const avatarUserId = getKickBroadcasterUserIdFromAvatar(candidate.profileImage);
    return avatarUserId !== null && identityIds.has(avatarUserId);
  });
  if (!follow) return;

  const updates: Partial<
    Pick<typeof follow, "channelId" | "channelName" | "displayName" | "profileImage">
  > = {};
  if (follow.channelId !== canonicalChannelId) updates.channelId = canonicalChannelId;
  if (follow.channelName !== channel.username) updates.channelName = channel.username;
  if (follow.displayName !== channel.displayName) updates.displayName = channel.displayName;
  if (follow.profileImage !== channel.avatarUrl) updates.profileImage = channel.avatarUrl;
  if (Object.keys(updates).length === 0) return;

  storageService.updateLocalFollow(follow.id, updates);
  if (channel.platform === "kick" && follow.source === "kick") {
    storageService.upsertSyncedFollows(
      "kick",
      [
        {
          platform: "kick",
          channelId: canonicalChannelId,
          channelName: channel.username,
          displayName: channel.displayName,
          profileImage: channel.avatarUrl,
        },
      ],
      { pruneAbsent: false }
    );
  }
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
      try {
        let channel: UnifiedChannel | null = null;

        if (params.platform === "twitch") {
          const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
          const channels = await twitchClient.getChannelsById([params.channelId]);
          channel = channels[0] || null;
        } else if (params.platform === "kick") {
          const { kickClient } = await import("../../api/platforms/kick/kick-client");
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
        freshChatroomSettings?: boolean;
      }
    ) => {
      try {
        let channel: UnifiedChannel | null = null;
        const requestedUsername = params.username.trim().toLowerCase();

        if (params.platform === "twitch") {
          const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
          // Use GQL (no auth needed) for channel lookup by login
          channel = await twitchClient.getChannelByLogin(params.username);
          if (!channel) {
            const staleFollow = storageService
              .getActiveFollowsByPlatform("twitch")
              .find(
                (follow) =>
                  follow.channelName.toLowerCase() === requestedUsername &&
                  /^\d+$/.test(follow.channelId)
              );
            if (staleFollow) {
              channel = (await twitchClient.getChannelsById([staleFollow.channelId]))[0] || null;
            }
          }
        } else if (params.platform === "kick") {
          const { kickClient } = await import("../../api/platforms/kick/kick-client");
          let authoritativeNotFoundFollowId: string | undefined;
          const staleFollow = storageService
            .getActiveFollowsByPlatform("kick")
            .find(
              (follow) =>
                follow.channelName.toLowerCase() === requestedUsername && follow.source === "kick"
            );
          try {
            channel = params.freshChatroomSettings
              ? await kickClient.getChannel(params.username, { freshChatroomSettings: true })
              : await kickClient.getChannel(params.username);
          } catch (error) {
            if (!staleFollow) throw error;

            channel = {
              id: staleFollow.channelId,
              platform: "kick",
              username: staleFollow.channelName,
              displayName: staleFollow.displayName || staleFollow.channelName,
              avatarUrl: staleFollow.profileImage || "",
              isLive: false,
              isVerified: false,
              isPartner: false,
              kickUserId:
                firstValidKickBroadcasterUserId(
                  getKickBroadcasterUserIdFromAvatar(staleFollow.profileImage),
                  staleFollow.channelId
                ) ?? undefined,
              accountStatus: "unavailable",
            };
          }
          if (!channel) {
            const broadcasterUserId = staleFollow
              ? firstValidKickBroadcasterUserId(
                  getKickBroadcasterUserIdFromAvatar(staleFollow.profileImage),
                  staleFollow.channelId
                )
              : null;
            if (staleFollow && broadcasterUserId) {
              channel =
                (await kickClient.getChannelsByBroadcasterIds([Number(broadcasterUserId)]))[0] ||
                null;
            }
            if (!channel) {
              const accountStatus = await kickClient.getOfficialChannelAccountStatus(
                params.username
              );
              if (accountStatus === "not_found" && staleFollow && !broadcasterUserId) {
                authoritativeNotFoundFollowId = staleFollow.id;
              } else if (staleFollow) {
                channel = {
                  id: staleFollow.channelId,
                  platform: "kick",
                  username: staleFollow.channelName,
                  displayName: staleFollow.displayName || staleFollow.channelName,
                  avatarUrl: staleFollow.profileImage || "",
                  isLive: false,
                  isVerified: false,
                  isPartner: false,
                  kickUserId: broadcasterUserId ?? undefined,
                  accountStatus: "unavailable",
                };
              }
            }
          }
          try {
            const statusSearch = await kickClient.searchChannels(params.username, { limit: 10 });
            const suspendedChannel = statusSearch?.data?.find(
              (candidate) =>
                candidate.username.toLowerCase() === requestedUsername &&
                candidate.accountStatus === "suspended"
            );
            if (suspendedChannel) {
              channel = {
                ...channel,
                ...suspendedChannel,
                id: channel?.id || suspendedChannel.id,
                kickUserId:
                  channel?.kickUserId || suspendedChannel.kickUserId || suspendedChannel.id,
                avatarUrl: suspendedChannel.avatarUrl || channel?.avatarUrl || "",
                displayName:
                  suspendedChannel.displayName || channel?.displayName || params.username,
                isLive: false,
                accountStatus: "suspended",
              };
            }
          } catch (error) {
            logger.debug("IPC:Channel", "Kick suspension lookup was unavailable", {
              username: params.username,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          if (authoritativeNotFoundFollowId && channel?.accountStatus !== "suspended") {
            storageService.removeLocalFollow(authoritativeNotFoundFollowId);
            channel = null;
          }
          if (channel && !channel.accountStatus) {
            channel = { ...channel, accountStatus: "active" };
          }
          channel = enrichOwnKickChannel(channel, params.username, storageService.getKickUser());
        }

        if (channel) refreshStoredFollowFromResolvedChannel(channel, params.username);

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
      try {
        let channels: UnifiedChannel[] = [];

        if (params.platform === "twitch") {
          const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
          if (twitchClient.isAuthenticated()) {
            // Get all followed channels
            channels = await twitchClient.getAllFollowedChannels();
          }
        } else if (params.platform === "kick") {
          const { kickClient } = await import("../../api/platforms/kick/kick-client");
          const follows = storageService.getActiveFollowsByPlatform("kick");
          channels = await buildKickFollowedChannelSnapshot(kickClient, follows);
        }

        return { success: true, data: dedupeChannelsByIdentity(channels) };
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
