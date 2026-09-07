import type {
  TimeoutActionBinding,
  TimeoutSnapshotResult,
  TimeoutSubmitInput,
  TimeoutSubmitResult,
} from "@shared/timeout-moderation-types";
import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";

export interface ChatModerationController {
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
  moderation: {
    createTimeoutSnapshot: (binding: TimeoutActionBinding) => Promise<TimeoutSnapshotResult>;
    submitTimeout: (input: TimeoutSubmitInput) => Promise<TimeoutSubmitResult>;
  };
}
