import type { KickChannelViewerRoleResult } from "@shared/kick-web-api-types";
import type { Platform } from "@streamfusion/core/platform";
import type { TokenStatusResult } from "@shared/ipc-channels";
import type {
  ModerationHistoryResult,
  ModLogQueryFilters,
  RetentionScope,
} from "@shared/mod-log-types";
import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";

export interface ModerationServices {
  kickChat: { getViewerRole(channelSlug: string): Promise<KickChannelViewerRoleResult> };
  twitch: {
    execute: (command: TwitchApiCommand) => Promise<TwitchApiResult>;
    eventSub: {
      start: (params: {
        feedId: string;
        userId: string;
        channelId: string;
        eventTypes?: Array<"channel.moderate" | "automod.message.hold" | "automod.message.update">;
      }) => Promise<TwitchApiResult>;
      stop: (feedId: string) => Promise<boolean>;
      onEvent: (callback: (event: { feedId: string; payload: unknown }) => void) => () => void;
      onState: (callback: (event: { feedId: string; state: string }) => void) => () => void;
    };
  };
  modLog: {
    query: (filters: ModLogQueryFilters) => Promise<ModerationHistoryResult>;
  };
  retention: {
    get: (scope: RetentionScope) => Promise<number | null | undefined>;
    set: (scope: RetentionScope, days: number | null) => Promise<void>;
  };
  auth: {
    tokenStatus: (platform: Platform) => Promise<TokenStatusResult>;
  };
}
