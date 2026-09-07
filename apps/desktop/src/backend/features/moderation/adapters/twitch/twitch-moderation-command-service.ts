import { executeTwitchModViewCommand } from "./twitch-mod-view-reads";
import * as UserEndpoints from "./user-block-endpoints";
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
import { getCurrentUser } from "../../../authentication/adapters/twitch/twitch-command-actor";

const moderatedChannelsResponseSchema = helixResponseSchema(
  z.object({
    broadcaster_id: z.string(),
    broadcaster_login: z.string(),
    broadcaster_name: z.string(),
  })
);

export async function executeTwitchModerationCommand(
  requestor: TwitchRequestPort,
  command: TwitchApiCommand
): Promise<TwitchApiResult | null> {
  const modViewResult = await executeTwitchModViewCommand(requestor, command);
  if (modViewResult) return modViewResult;
  if (command.operation === "block-user" || command.operation === "unblock-user") {
    const rawResponse = await (command.operation === "block-user"
      ? UserEndpoints.blockUser(requestor, command.targetUserId)
      : UserEndpoints.unblockUser(requestor, command.targetUserId));
    const response = emptyResponseSchema.parse(rawResponse);
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
      query(command.operation === "get-moderators" ? "/moderation/moderators" : "/channels/vips", {
        broadcaster_id: command.broadcasterId,
        ...(command.operation === "get-moderators" ? { user_id: command.userId } : {}),
        first: command.operation === "get-moderators" && command.userId ? 1 : 100,
      })
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

  if (command.operation === "manage-held-automod") {
    const actor = await getCurrentUser(requestor);
    const response = await requestDecoded(
      requestor,
      emptyResponseSchema,
      "/moderation/automod/message",
      {
        method: "POST",
        body: JSON.stringify({
          user_id: actor.id,
          msg_id: command.messageId,
          action: command.action,
        }),
      }
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
  return null;
}
