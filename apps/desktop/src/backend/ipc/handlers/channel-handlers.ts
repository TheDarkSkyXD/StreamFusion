import { ipcMain } from "electron";

import { logger } from "@/backend/logging/logger";
import { dedupeChannelsByIdentity } from "@/lib/id-utils";
import {
  firstValidKickBroadcasterUserId,
  getKickBroadcasterUserIdFromAvatar,
} from "@/lib/kick-channel-identity";
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
        let channel: UnifiedChannel | null = null;

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
        let channel: UnifiedChannel | null = null;
        const requestedUsername = params.username.trim().toLowerCase();

        if (params.platform === "twitch") {
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
              if (channel && channel.username.toLowerCase() !== requestedUsername) {
                storageService.updateLocalFollow(staleFollow.id, {
                  channelName: channel.username,
                  displayName: channel.displayName,
                  profileImage: channel.avatarUrl,
                });
              }
            }
          }
        } else if (params.platform === "kick") {
          let authoritativeNotFoundFollowId: string | undefined;
          const staleFollow = storageService
            .getActiveFollowsByPlatform("kick")
            .find(
              (follow) =>
                follow.channelName.toLowerCase() === requestedUsername && follow.source === "kick"
            );
          try {
            channel = await kickClient.getChannel(params.username);
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
                (
                  await kickClient.getChannelsByBroadcasterIds([Number(broadcasterUserId)])
                )[0] || null;
              if (channel && channel.username.toLowerCase() !== requestedUsername) {
                storageService.updateLocalFollow(staleFollow.id, {
                  channelName: channel.username,
                  displayName: channel.displayName,
                  profileImage: channel.avatarUrl,
                });
                storageService.upsertSyncedFollows(
                  "kick",
                  [
                    {
                      platform: "kick",
                      channelId: channel.kickUserId ?? channel.id,
                      channelName: channel.username,
                      displayName: channel.displayName,
                      profileImage: channel.avatarUrl,
                    },
                  ],
                  { pruneAbsent: false }
                );
              }
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

          channels = (
            await Promise.all(
              follows.map(async (follow): Promise<UnifiedChannel | null> => {
                const current = repairedChannels.get(follow.id);
                let suspendedChannel: UnifiedChannel | undefined;

                try {
                  const statusSearch = await kickClient.searchChannels(follow.channelName, {
                    limit: 10,
                  });
                  suspendedChannel = statusSearch?.data?.find(
                    (candidate) =>
                      candidate.username.toLowerCase() === follow.channelName.toLowerCase() &&
                      candidate.accountStatus === "suspended"
                  );
                } catch (error) {
                  logger.debug(
                    "IPC:Channel",
                    "Kick followed-channel status lookup was unavailable",
                    {
                      username: follow.channelName,
                      error: error instanceof Error ? error.message : String(error),
                    }
                  );
                }

                const providerChannel = suspendedChannel || current;
                const broadcasterUserId = firstValidKickBroadcasterUserId(
                  providerChannel?.kickUserId,
                  getKickBroadcasterUserIdFromAvatar(
                    providerChannel?.avatarUrl || follow.profileImage
                  ),
                  follow.channelId
                );

                if (!providerChannel) {
                  let officialStatus;
                  try {
                    officialStatus = await kickClient.getOfficialChannelAccountStatus(
                      follow.channelName
                    );
                  } catch (error) {
                    logger.debug("IPC:Channel", "Official Kick account lookup was unavailable", {
                      username: follow.channelName,
                      error: error instanceof Error ? error.message : String(error),
                    });
                  }
                  if (officialStatus === "not_found" && !broadcasterUserId) {
                    storageService.removeLocalFollow(follow.id);
                    return null;
                  }
                }

                return {
                  id: follow.channelId,
                  platform: "kick",
                  username: providerChannel?.username || follow.channelName,
                  displayName:
                    providerChannel?.displayName || follow.displayName || follow.channelName,
                  avatarUrl: providerChannel?.avatarUrl || follow.profileImage || "",
                  isLive: suspendedChannel ? false : current?.isLive || false,
                  isVerified: providerChannel?.isVerified || false,
                  isPartner: providerChannel?.isPartner || false,
                  kickUserId: broadcasterUserId ?? undefined,
                  accountStatus: suspendedChannel
                    ? "suspended"
                    : current
                      ? "active"
                      : "unavailable",
                };
              })
            )
          ).filter((channel): channel is UnifiedChannel => channel !== null);
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
