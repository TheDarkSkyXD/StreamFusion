import type {
  ResolvedTwitchChannel,
  TwitchApiCommand,
  TwitchApiResult,
} from "@shared/twitch-api-types";
import { z } from "zod";

import { helixResponseSchema } from "./twitch-helix-schemas";
import { twitchClient } from "./twitch-client";

export interface TwitchApiService {
  execute(command: TwitchApiCommand): Promise<TwitchApiResult>;
}

interface TwitchRequestPort {
  request(endpoint: string, options?: RequestInit): Promise<unknown>;
}

const unknownResponseSchema = helixResponseSchema(z.unknown());
const emptyResponseSchema = z.null();
const moderatedChannelsResponseSchema = helixResponseSchema(
  z.object({
    broadcaster_id: z.string(),
    broadcaster_login: z.string(),
    broadcaster_name: z.string(),
  })
);
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
const resolvedUserResponseSchema = helixResponseSchema(
  z.object({ id: z.string(), login: z.string(), display_name: z.string() })
);

type TwitchResponseSchema<T> = z.ZodType<T>;

async function requestDecoded<T>(
  requestor: TwitchRequestPort,
  schema: TwitchResponseSchema<T>,
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const response = options
    ? await requestor.request(endpoint, options)
    : await requestor.request(endpoint);
  return schema.parse(response);
}

function query(path: string, values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

export function createTwitchApiService(requestor: TwitchRequestPort): TwitchApiService {
  return {
    async execute(command) {
      try {
        if (command.operation === "get-global-emotes") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            "/chat/emotes/global"
          );
          return { ok: true, data: response };
        }

        if (command.operation === "get-channel-emotes") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/chat/emotes", { broadcaster_id: command.broadcasterId })
          );
          return { ok: true, data: response };
        }

        if (command.operation === "get-emote-set") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/chat/emotes/set", { emote_set_id: command.emoteSetId })
          );
          return { ok: true, data: response };
        }

        if (command.operation === "get-user-emotes") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/chat/emotes/user", { user_id: command.userId, after: command.after })
          );
          return { ok: true, data: response };
        }

        if (command.operation === "get-users") {
          const params = new URLSearchParams();
          for (const userId of command.userIds) params.append("id", userId);
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            `/users?${params.toString()}`
          );
          return { ok: true, data: response };
        }

        if (command.operation === "get-moderated-channels") {
          const response = await requestDecoded(
            requestor,
            moderatedChannelsResponseSchema,
            `/moderation/channels?user_id=${encodeURIComponent(command.userId)}&first=100`
          );
          return { ok: true, data: response.data ?? [] };
        }

        if (command.operation === "get-chat-settings") {
          const response = await requestDecoded(
            requestor,
            chatSettingsResponseSchema,
            `/chat/settings?broadcaster_id=${encodeURIComponent(command.broadcasterId)}`
          );
          return { ok: true, data: response.data?.[0] ?? null };
        }

        if (command.operation === "get-banned-users") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/moderation/banned", {
              broadcaster_id: command.broadcasterId,
              first: 100,
              after: command.cursor,
              user_id: command.userId,
            })
          );
          return {
            ok: true,
            data: { data: response.data ?? [], cursor: response.pagination?.cursor ?? null },
          };
        }

        if (command.operation === "get-moderators" || command.operation === "get-vips") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query(
              command.operation === "get-moderators" ? "/moderation/moderators" : "/channels/vips",
              {
                broadcaster_id: command.broadcasterId,
                ...(command.operation === "get-moderators" ? { user_id: command.userId } : {}),
                first: command.operation === "get-moderators" && command.userId ? 1 : 100,
              }
            )
          );
          return {
            ok: true,
            data: { data: response.data ?? [], pagination: response.pagination ?? {} },
          };
        }

        if (command.operation === "get-unban-requests") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/moderation/unban_requests", {
              broadcaster_id: command.broadcasterId,
              moderator_id: command.moderatorId,
              status: command.status,
              user_id: command.userId,
              after: command.after,
              first: 20,
            })
          );
          return {
            ok: true,
            data: { data: response.data ?? [], pagination: response.pagination ?? {} },
          };
        }

        if (command.operation === "get-polls" || command.operation === "get-predictions") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query(command.operation === "get-polls" ? "/polls" : "/predictions", {
              broadcaster_id: command.broadcasterId,
            })
          );
          return { ok: true, data: { data: response.data ?? [] } };
        }

        if (command.operation === "create-poll") {
          const response = await requestDecoded(requestor, unknownResponseSchema, "/polls", {
            method: "POST",
            body: JSON.stringify({
              broadcaster_id: command.broadcasterId,
              title: command.title,
              choices: command.choices.map((title) => ({ title })),
              duration: command.duration,
            }),
          });
          return { ok: true, data: response.data?.[0] };
        }

        if (command.operation === "end-poll") {
          const response = await requestDecoded(requestor, unknownResponseSchema, "/polls", {
            method: "PATCH",
            body: JSON.stringify({
              broadcaster_id: command.broadcasterId,
              id: command.pollId,
              status: command.status,
            }),
          });
          return { ok: true, data: response.data?.[0] };
        }

        if (command.operation === "create-prediction") {
          const response = await requestDecoded(requestor, unknownResponseSchema, "/predictions", {
            method: "POST",
            body: JSON.stringify({
              broadcaster_id: command.broadcasterId,
              title: command.title,
              outcomes: command.outcomes.map((title) => ({ title })),
              prediction_window: command.predictionWindow,
            }),
          });
          return { ok: true, data: response.data?.[0] };
        }

        if (command.operation === "end-prediction") {
          const response = await requestDecoded(requestor, unknownResponseSchema, "/predictions", {
            method: "PATCH",
            body: JSON.stringify({
              broadcaster_id: command.broadcasterId,
              id: command.predictionId,
              status: command.status,
              ...(command.winningOutcomeId ? { winning_outcome_id: command.winningOutcomeId } : {}),
            }),
          });
          return { ok: true, data: response.data?.[0] };
        }

        if (command.operation === "ban-user") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/moderation/bans", {
              broadcaster_id: command.broadcasterId,
              moderator_id: command.moderatorId,
            }),
            {
              method: "POST",
              body: JSON.stringify({
                data: {
                  user_id: command.userId,
                  ...(command.reason ? { reason: command.reason } : {}),
                },
              }),
            }
          );
          return { ok: true, data: response.data?.[0] };
        }

        if (command.operation === "warn-user") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/moderation/warnings", {
              broadcaster_id: command.broadcasterId,
              moderator_id: command.moderatorId,
            }),
            {
              method: "POST",
              body: JSON.stringify({ data: { user_id: command.userId, reason: command.reason } }),
            }
          );
          return { ok: true, data: response.data?.[0] };
        }

        if (command.operation === "clear-chat") {
          const response = await requestDecoded(
            requestor,
            emptyResponseSchema,
            query("/moderation/chat", {
              broadcaster_id: command.broadcasterId,
              moderator_id: command.moderatorId,
            }),
            { method: "DELETE" }
          );
          return { ok: true, data: response };
        }

        if (command.operation === "set-shield-mode") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/moderation/shield_mode", {
              broadcaster_id: command.broadcasterId,
              moderator_id: command.moderatorId,
            }),
            { method: "PUT", body: JSON.stringify({ is_active: command.active }) }
          );
          return { ok: true, data: response.data?.[0] };
        }

        if (command.operation === "start-raid") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/raids", {
              from_broadcaster_id: command.fromBroadcasterId,
              to_broadcaster_id: command.toBroadcasterId,
            }),
            { method: "POST" }
          );
          return { ok: true, data: response.data?.[0] };
        }

        if (command.operation === "run-commercial") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            "/channels/commercial",
            {
              method: "POST",
              body: JSON.stringify({
                broadcaster_id: command.broadcasterId,
                length: command.length,
              }),
            }
          );
          return { ok: true, data: response.data?.[0] };
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

        if (command.operation === "delete-chat-message") {
          const response = await requestDecoded(
            requestor,
            emptyResponseSchema,
            query("/moderation/chat", {
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

        if (command.operation === "unban-user") {
          const response = await requestDecoded(
            requestor,
            emptyResponseSchema,
            query("/moderation/bans", {
              broadcaster_id: command.broadcasterId,
              moderator_id: command.moderatorId,
              user_id: command.userId,
            }),
            { method: "DELETE" }
          );
          return { ok: true, data: response };
        }

        if (
          command.operation === "add-moderator" ||
          command.operation === "remove-moderator" ||
          command.operation === "add-vip" ||
          command.operation === "remove-vip"
        ) {
          const isModerator = command.operation.endsWith("moderator");
          const isAdd = command.operation.startsWith("add-");
          const response = await requestDecoded(
            requestor,
            emptyResponseSchema,
            query(isModerator ? "/moderation/moderators" : "/channels/vips", {
              broadcaster_id: command.broadcasterId,
              user_id: command.userId,
            }),
            { method: isAdd ? "POST" : "DELETE" }
          );
          return { ok: true, data: response };
        }

        if (command.operation === "resolve-unban-request") {
          const response = await requestDecoded(
            requestor,
            unknownResponseSchema,
            query("/moderation/unban_requests", {
              broadcaster_id: command.broadcasterId,
              moderator_id: command.moderatorId,
              unban_request_id: command.unbanRequestId,
              status: command.status,
              resolution_text: command.resolutionText,
            }),
            { method: "PATCH" }
          );
          return { ok: true, data: response.data?.[0] };
        }

        if (command.operation !== "resolve-channel") {
          return {
            ok: false,
            error: { code: "invalid-input", message: "Unsupported Twitch operation." },
          };
        }
        const response = await requestDecoded(
          requestor,
          resolvedUserResponseSchema,
          `/users?login=${encodeURIComponent(command.login.toLowerCase())}`
        );
        const user = response.data?.[0];
        const data: ResolvedTwitchChannel | null = user
          ? { id: user.id, login: user.login, displayName: user.display_name }
          : null;
        return { ok: true, data };
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

export const twitchApiService = createTwitchApiService(twitchClient);
