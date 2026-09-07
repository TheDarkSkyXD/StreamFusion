import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";
import { twitchTransport, type TwitchHelixRequestPort } from "./twitch-transport";
import { executeSlashCommand } from "../../../features/chat/adapters/twitch/twitch-slash-command-service";
import { executeTwitchEmoteCommand } from "../../../features/chat/adapters/twitch/twitch-emote-command-service";
import { executeTwitchEngagementCommand } from "../../../features/chat/adapters/twitch/twitch-engagement-command-service";
import { executeTwitchChatCommand } from "../../../features/chat/adapters/twitch/twitch-chat-command-service";
import { executeTwitchModerationCommand } from "../../../features/moderation/adapters/twitch/twitch-moderation-command-service";
import { executeTwitchDiscoveryCommand } from "../../../features/discovery/adapters/twitch/twitch-discovery-command-service";

export interface TwitchApiService {
  execute(command: TwitchApiCommand): Promise<TwitchApiResult>;
}

const commandHandlers = [
  executeTwitchEmoteCommand,
  executeTwitchEngagementCommand,
  executeTwitchChatCommand,
  executeTwitchModerationCommand,
  executeTwitchDiscoveryCommand,
];

export function createTwitchApiService(requestor: TwitchHelixRequestPort): TwitchApiService {
  return {
    async execute(command) {
      try {
        if (command.operation === "execute-slash-command") {
          return { ok: true, data: await executeSlashCommand(requestor, command) };
        }
        for (const handler of commandHandlers) {
          const result = await handler(requestor, command);
          if (result) return result;
        }
        return {
          ok: false,
          error: { code: "invalid-input", message: "Unsupported Twitch operation." },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: error instanceof Error ? error.message : "Twitch is unavailable.",
          },
        };
      }
    },
  };
}

export const twitchApiService = createTwitchApiService(twitchTransport);
