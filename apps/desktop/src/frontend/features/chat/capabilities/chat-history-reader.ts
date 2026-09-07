import type { Platform } from "@streamfusion/core/platform";
import type {
  SubscriberEligibilityRequest,
  SubscriberEligibilityResult,
  TwitchBadgeCatalog,
} from "@shared/chat-types";
import type {
  CancelChatReplayWindowRequest,
  CancelChatReplayWindowResult,
  ChatReplayIpcWindowRequest,
  ChatReplayIpcWindowResult,
} from "@shared/chat-replay-types";
import type { IpcResult } from "@shared/ipc-channels";

export interface ChatHistoryReader {
  chat: {
    getKickHistory: (params: { channelId: string; channelSlug: string }) => Promise<{
      success: boolean;
      data?: {
        messages: Array<{
          id: string;
          chatroom_id: number;
          content: string;
          type: string;
          created_at: string;
          sender: {
            id: number;
            username: string;
            slug: string;
            identity: {
              color: string;
              badges: Array<{ type: string; text: string; count?: number }>;
            };
          };
          metadata: string | null;
        }>;
        pinnedMessage: unknown | null;
      } | null;
      error?: string;
    }>;
    getTwitchHistory: (params: { channel: string }) => Promise<{
      success: boolean;
      data?: { rawMessages: string[] } | null;
      error?: string;
    }>;
    getTwitchBadgeCatalog: (params: {
      broadcasterId: string;
      channelLogin: string;
      forceRefresh?: boolean;
    }) => Promise<IpcResult<TwitchBadgeCatalog>>;
    getTwitchPinnedMessage: (params: { channel: string }) => Promise<IpcResult<unknown | null>>;
    enrichMentionUsers: (params: {
      platform: Platform;
      channel?: string;
      users: Array<{ userId?: string; username: string }>;
    }) => Promise<{
      success: boolean;
      data?: Array<{
        userId: string;
        username: string;
        displayName: string;
        avatarUrl?: string;
      }>;
      error?: string;
    }>;
    checkSubscriberEligibility: (
      request: SubscriberEligibilityRequest
    ) => Promise<SubscriberEligibilityResult>;
  };
  videos: {
    getChatReplayWindow: (
      request: ChatReplayIpcWindowRequest
    ) => Promise<ChatReplayIpcWindowResult>;
    cancelChatReplayWindow: (
      request: CancelChatReplayWindowRequest
    ) => Promise<CancelChatReplayWindowResult>;
  };
}
