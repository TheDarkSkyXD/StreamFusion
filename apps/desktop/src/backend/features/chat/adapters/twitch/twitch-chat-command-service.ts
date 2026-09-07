import type { TwitchApiCommand, TwitchApiResult } from "@shared/twitch-api-types";
import { z } from "zod";
import { helixResponseSchema } from "@backend/api/platforms/twitch/twitch-helix-schemas";
import type { TwitchHelixRequestPort as TwitchRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import {
  requestDecoded,
  query,
  unknownResponseSchema,
  emptyResponseSchema,
} from "@backend/api/platforms/twitch/twitch-command-request";

const chatSettingsResponseSchema = helixResponseSchema(
  z.object({
    broadcaster_id: z.string(),
    moderator_id: z.string().optional(),
    slow_mode: z.boolean().optional(),
    slow_mode_wait_time: z.number().nullable().optional(),
    follower_mode: z.boolean().optional(),
    follower_mode_duration: z.number().nullable().optional(),
    subscriber_mode: z.boolean().optional(),
    emote_mode: z.boolean().optional(),
    unique_chat_mode: z.boolean().optional(),
    non_moderator_chat_delay: z.boolean().optional(),
    non_moderator_chat_delay_duration: z.number().nullable().optional(),
  })
);

export async function executeTwitchChatCommand(
  requestor: TwitchRequestPort,
  command: TwitchApiCommand
): Promise<TwitchApiResult | null> {
  if (command.operation === "get-chat-settings") {
    const response = await requestDecoded(
      requestor,
      chatSettingsResponseSchema,
      `/chat/settings?broadcaster_id=${encodeURIComponent(command.broadcasterId)}`
    );
    return { ok: true, data: response.data?.[0] ?? null };
  }

  if (command.operation === "pin-message" || command.operation === "update-pin") {
    const response = await requestDecoded(
      requestor,
      emptyResponseSchema,
      query("/chat/pins", {
        broadcaster_id: command.broadcasterId,
        moderator_id: command.moderatorId,
        message_id: command.messageId,
        duration_seconds: command.durationSeconds ?? undefined,
      }),
      { method: command.operation === "pin-message" ? "PUT" : "PATCH" }
    );
    return { ok: true, data: response };
  }

  if (command.operation === "unpin-message") {
    const response = await requestDecoded(
      requestor,
      emptyResponseSchema,
      query("/chat/pins", {
        broadcaster_id: command.broadcasterId,
        moderator_id: command.moderatorId,
        message_id: command.messageId,
      }),
      { method: "DELETE" }
    );
    return { ok: true, data: response };
  }

  if (command.operation === "update-chat-settings") {
    const response = await requestDecoded(
      requestor,
      unknownResponseSchema,
      query("/chat/settings", {
        broadcaster_id: command.broadcasterId,
        moderator_id: command.moderatorId,
      }),
      { method: "PATCH", body: JSON.stringify(command.settings) }
    );
    return { ok: true, data: response.data?.[0] };
  }
  return null;
}
