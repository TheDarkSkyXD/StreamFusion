import { app, type IpcMainInvokeEvent, ipcMain } from "electron";

import { getUserProfileFixture } from "../../../dev-relay/user-profile-fixtures";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import type {
  ProfileFieldState,
  TwitchAccountCreatedRequest,
  TwitchChannelRequest,
  TwitchFollowRequest,
  TwitchIdentityRequest,
  TwitchPublicIdentity,
  TwitchResolvedChannel,
} from "../../../shared/user-profile-types";

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

export function registerUserProfileHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.USER_PROFILE_TWITCH_IDENTITY,
    async (event, request: TwitchIdentityRequest) =>
      readWithDevelopmentFixture<TwitchPublicIdentity>(
        event,
        ["userProfiles", "getTwitchIdentity"],
        async () => {
          const { getTwitchPublicIdentity } = await import(
            "../../api/platforms/twitch/twitch-public-profile-reader"
          );
          return getTwitchPublicIdentity(request.userId, request.username);
        }
      )
  );

  ipcMain.handle(
    IPC_CHANNELS.USER_PROFILE_TWITCH_ACCOUNT_CREATED,
    async (event, request: TwitchAccountCreatedRequest) =>
      readWithDevelopmentFixture<string>(
        event,
        ["userProfiles", "getTwitchAccountCreated"],
        async () => {
          const { getTwitchAccountCreated } = await import(
            "../../api/platforms/twitch/twitch-public-profile-reader"
          );
          return getTwitchAccountCreated(request.userId, request.username);
        }
      )
  );

  ipcMain.handle(
    IPC_CHANNELS.USER_PROFILE_TWITCH_FOLLOW,
    async (event, request: TwitchFollowRequest) =>
      readWithDevelopmentFixture<string>(event, ["userProfiles", "getTwitchFollow"], async () => {
        const { getTwitchFollowRelationship } = await import(
          "../../api/platforms/twitch/twitch-public-profile-reader"
        );
        return getTwitchFollowRelationship(request.broadcasterId, request.userId, request.username);
      })
  );

  ipcMain.handle(
    IPC_CHANNELS.USER_PROFILE_TWITCH_CHANNEL,
    async (event, request: TwitchChannelRequest) =>
      readWithDevelopmentFixture<TwitchResolvedChannel>(
        event,
        ["userProfiles", "resolveTwitchChannel"],
        async () => {
          const { resolveTwitchPublicChannel } = await import(
            "../../api/platforms/twitch/twitch-public-profile-reader"
          );
          return resolveTwitchPublicChannel(request.username);
        }
      )
  );
}
