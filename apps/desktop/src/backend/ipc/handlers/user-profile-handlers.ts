import { app, type IpcMainInvokeEvent } from "electron";

import { getUserProfileFixture } from "../../../dev-relay/user-profile-fixtures";
import { userProfileIpcContracts } from "../../../ipc-contracts/user-profile-contracts";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type {
  KickPublicIdentity,
  KickResolvedChannel,
  ProfileFieldState,
  TwitchPublicIdentity,
  TwitchResolvedChannel,
} from "../../../shared/user-profile-types";
import type { TrustedIpcRegistry } from "../trusted-ipc-registry";

const unavailableProfile = { state: "failed", message: "Unavailable" } as const;

async function readWithDevelopmentFixture<T>(
  event: IpcMainInvokeEvent,
  path: readonly string[],
  read: () => Promise<ProfileFieldState<T>>
): Promise<ProfileFieldState<T>> {
  if (!app.isPackaged) {
    let search = "";
    try {
      search = new URL(event.senderFrame?.url ?? "").search;
    } catch {
      // An invalid or absent sender URL cannot opt into a development fixture.
    }
    const fixture = getUserProfileFixture(path, search);
    if (fixture.matched) return fixture.value;
  }

  return read();
}

export function registerUserProfileHandlers(registry: TrustedIpcRegistry): void {
  registry.handle({
    channel: IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY,
    contract: userProfileIpcContracts[IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY],
    failureResponse: unavailableProfile,
    execute: async (event, request) =>
      readWithDevelopmentFixture<TwitchPublicIdentity>(
        event,
        ["userProfiles", "getTwitchIdentity"],
        async () => {
          const { getTwitchPublicIdentity } =
            await import("../../api/platforms/twitch/twitch-public-profile-reader");
          return getTwitchPublicIdentity(request.userId, request.username);
        }
      ),
  });

  registry.handle({
    channel: IPC_CHANNELS.USER_PROFILE_KICK_IDENTITY,
    contract: userProfileIpcContracts[IPC_CHANNELS.USER_PROFILE_KICK_IDENTITY],
    failureResponse: unavailableProfile,
    execute: async (event, request) =>
      readWithDevelopmentFixture<KickPublicIdentity>(
        event,
        ["userProfiles", "getKickIdentity"],
        async () => {
          const { getKickPublicIdentity } =
            await import("../../api/platforms/kick/kick-public-profile-reader");
          return getKickPublicIdentity(request.userId, request.username, request.channelSlug);
        }
      ),
  });

  registry.handle({
    channel: IPC_CHANNELS.USER_PROFILE_KICK_ACCOUNT_CREATED,
    contract: userProfileIpcContracts[IPC_CHANNELS.USER_PROFILE_KICK_ACCOUNT_CREATED],
    failureResponse: unavailableProfile,
    execute: async (event, request) =>
      readWithDevelopmentFixture<string>(
        event,
        ["userProfiles", "getKickAccountCreated"],
        async () => {
          const { getKickAccountCreated } =
            await import("../../api/platforms/kick/kick-public-profile-reader");
          return getKickAccountCreated(request.userId, request.username, request.channelSlug);
        }
      ),
  });

  registry.handle({
    channel: IPC_CHANNELS.USER_PROFILE_KICK_FOLLOW,
    contract: userProfileIpcContracts[IPC_CHANNELS.USER_PROFILE_KICK_FOLLOW],
    failureResponse: unavailableProfile,
    execute: async (event, request) =>
      readWithDevelopmentFixture<string>(event, ["userProfiles", "getKickFollow"], async () => {
        const { getKickFollowRelationship } =
          await import("../../api/platforms/kick/kick-public-profile-reader");
        return getKickFollowRelationship(request.userId, request.username, request.channelSlug);
      }),
  });

  registry.handle({
    channel: IPC_CHANNELS.USER_PROFILE_KICK_CHANNEL,
    contract: userProfileIpcContracts[IPC_CHANNELS.USER_PROFILE_KICK_CHANNEL],
    failureResponse: unavailableProfile,
    execute: async (event, request) =>
      readWithDevelopmentFixture<KickResolvedChannel>(
        event,
        ["userProfiles", "resolveKickChannel"],
        async () => {
          const { resolveKickPublicChannel } =
            await import("../../api/platforms/kick/kick-public-profile-reader");
          return resolveKickPublicChannel(request.username);
        }
      ),
  });

  registry.handle({
    channel: IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED,
    contract: userProfileIpcContracts[IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED],
    failureResponse: unavailableProfile,
    execute: async (event, request) =>
      readWithDevelopmentFixture<string>(
        event,
        ["userProfiles", "getTwitchAccountCreated"],
        async () => {
          const { getTwitchAccountCreated } =
            await import("../../api/platforms/twitch/twitch-public-profile-reader");
          return getTwitchAccountCreated(request.userId, request.username);
        }
      ),
  });

  registry.handle({
    channel: IPC_CHANNELS.USER_PROFILE_TWITCH_FOLLOW,
    contract: userProfileIpcContracts[IPC_CHANNELS.USER_PROFILE_TWITCH_FOLLOW],
    failureResponse: unavailableProfile,
    execute: async (event, request) =>
      readWithDevelopmentFixture<string>(event, ["userProfiles", "getTwitchFollow"], async () => {
        const { getTwitchFollowRelationship } =
          await import("../../api/platforms/twitch/twitch-public-profile-reader");
        return getTwitchFollowRelationship(request.broadcasterId, request.userId, request.username);
      }),
  });

  registry.handle({
    channel: IPC_CHANNELS.USER_PROFILE_TWITCH_CHANNEL,
    contract: userProfileIpcContracts[IPC_CHANNELS.USER_PROFILE_TWITCH_CHANNEL],
    failureResponse: unavailableProfile,
    execute: async (event, request) =>
      readWithDevelopmentFixture<TwitchResolvedChannel>(
        event,
        ["userProfiles", "resolveTwitchChannel"],
        async () => {
          const { resolveTwitchPublicChannel } =
            await import("../../api/platforms/twitch/twitch-public-profile-reader");
          return resolveTwitchPublicChannel(request.username);
        }
      ),
  });
}
