import type {
  KickChatModeRequest,
  KickModerationResult,
  KickOfficialModerationTarget,
  KickOfficialTimeoutTarget,
} from "@shared/kick-moderation-types";
import type {
  KickChannelViewerRoleResult,
  KickPinMutationResult,
  KickPinPayload,
  KickWebApiMutationResult,
} from "@shared/kick-web-api-types";

export interface KickChatController {
  kickChat: {
    deleteMessage: (chatroomId: number, messageId: string) => Promise<KickWebApiMutationResult>;
    banUser: (channelSlug: string, username: string) => Promise<KickWebApiMutationResult>;
    unbanUser: (channelSlug: string, username: string) => Promise<KickWebApiMutationResult>;
    timeoutUser: (
      channelSlug: string,
      username: string,
      duration: number
    ) => Promise<KickWebApiMutationResult>;
    getViewerRole: (channelSlug: string) => Promise<KickChannelViewerRoleResult>;
    pinMessage: (payload: KickPinPayload) => Promise<KickPinMutationResult>;
    unpinMessage: (channelSlug: string) => Promise<KickPinMutationResult>;
    moderateBan: (payload: KickOfficialModerationTarget) => Promise<KickModerationResult>;
    moderateTimeout: (payload: KickOfficialTimeoutTarget) => Promise<KickModerationResult>;
    moderateUnban: (
      payload: Omit<KickOfficialModerationTarget, "reason">
    ) => Promise<KickModerationResult>;
    setMode: (payload: KickChatModeRequest) => Promise<KickModerationResult>;
  };
}
