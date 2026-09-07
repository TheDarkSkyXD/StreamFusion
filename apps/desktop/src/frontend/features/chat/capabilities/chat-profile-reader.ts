import type { UnifiedChannel } from "@shared/platform-types";
import type {
  AccountCreatedFieldState,
  ProfileFieldState,
  PublicUserIdentity,
  PublicResolvedChannel,
} from "@shared/user-profile-types";
import type { Platform } from "@streamfusion/core/platform";
import type { IpcResult } from "@shared/ipc-channels";

export interface ChatProfileReader {
  userProfiles: {
    getTwitchIdentity: (request: {
      userId: string;
      username: string;
    }) => Promise<ProfileFieldState<PublicUserIdentity>>;
    getTwitchAccountCreated: (request: {
      userId: string;
      username: string;
    }) => Promise<AccountCreatedFieldState>;
    getTwitchFollow: (request: {
      broadcasterId: string;
      userId: string;
      username: string;
    }) => Promise<ProfileFieldState<string>>;
    resolveTwitchChannel: (request: {
      username: string;
    }) => Promise<ProfileFieldState<PublicResolvedChannel>>;
    getKickIdentity: (request: {
      userId: string;
      username: string;
      channelSlug: string;
    }) => Promise<ProfileFieldState<PublicUserIdentity>>;
    getKickAccountCreated: (request: {
      userId: string;
      username: string;
      channelSlug: string;
    }) => Promise<AccountCreatedFieldState>;
    getKickFollow: (request: {
      userId: string;
      username: string;
      channelSlug: string;
    }) => Promise<ProfileFieldState<string>>;
    resolveKickChannel: (request: {
      username: string;
    }) => Promise<ProfileFieldState<PublicResolvedChannel>>;
  };
  channels: {
    getByUsername: (params: {
      platform: Platform;
      username: string;
      freshChatroomSettings?: boolean;
    }) => Promise<IpcResult<UnifiedChannel | null>>;
  };
}
