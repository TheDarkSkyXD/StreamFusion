import type { TwitchApiCommand, TwitchSlashCommandReceipt } from "@shared/twitch-api-types";
import { z } from "zod";
import { helixResponseSchema } from "@backend/api/platforms/twitch/twitch-helix-schemas";
import type { TwitchHelixRequestPort as TwitchRequestPort } from "@backend/api/platforms/twitch/twitch-transport";
import {
  requestDecoded,
  query,
  unknownResponseSchema,
  emptyResponseSchema,
} from "@backend/api/platforms/twitch/twitch-command-request";
import * as UserEndpoints from "../../../moderation/adapters/twitch/user-block-endpoints";
import {
  resolveTarget,
  type TwitchUserIdentity,
} from "../../../discovery/adapters/twitch/twitch-command-user-identity";
import { getCurrentUser } from "../../../authentication/adapters/twitch/twitch-command-actor";
import {
  targetLoginForAction,
  requireSlashCommandActor,
} from "../../domain/twitch-slash-command-policy";

const sendChatMessageResponseSchema = helixResponseSchema(
  z.object({
    message_id: z.string(),
    is_sent: z.boolean(),
    drop_reason: z.object({ code: z.string(), message: z.string() }).nullable().optional(),
  })
);

function resolvedTargetId(target: TwitchUserIdentity | null): string {
  if (!target) throw new Error("Twitch could not resolve the command target.");
  return target.id;
}

export async function executeSlashCommand(
  requestor: TwitchRequestPort,
  command: Extract<TwitchApiCommand, { operation: "execute-slash-command" }>
): Promise<TwitchSlashCommandReceipt> {
  const actor = await getCurrentUser(requestor);
  requireSlashCommandActor(command.action, actor.id, command.channel.id);
  const targetLogin = targetLoginForAction(command.action);
  const target = targetLogin ? await resolveTarget(requestor, targetLogin) : null;
  const action = command.action;

  switch (action.kind) {
    case "update-chat-color":
      await requestDecoded(
        requestor,
        emptyResponseSchema,
        query("/chat/color", { user_id: actor.id, color: action.color }),
        { method: "PUT" }
      );
      break;
    case "whisper":
      await requestDecoded(
        requestor,
        emptyResponseSchema,
        query("/whispers", { from_user_id: actor.id, to_user_id: resolvedTargetId(target) }),
        { method: "POST", body: JSON.stringify({ message: action.message }) }
      );
      break;
    case "block":
    case "unblock":
      await (action.kind === "block"
        ? UserEndpoints.blockUser(requestor, resolvedTargetId(target))
        : UserEndpoints.unblockUser(requestor, resolvedTargetId(target)));
      break;
    case "ban":
    case "timeout":
      await requestDecoded(
        requestor,
        unknownResponseSchema,
        query("/moderation/bans", {
          broadcaster_id: command.channel.id,
          moderator_id: actor.id,
        }),
        {
          method: "POST",
          body: JSON.stringify({
            data: {
              user_id: resolvedTargetId(target),
              ...(action.kind === "timeout" ? { duration: action.durationSeconds } : {}),
              ...(action.reason ? { reason: action.reason } : {}),
            },
          }),
        }
      );
      break;
    case "unban":
      await requestDecoded(
        requestor,
        emptyResponseSchema,
        query("/moderation/bans", {
          broadcaster_id: command.channel.id,
          moderator_id: actor.id,
          user_id: resolvedTargetId(target),
        }),
        { method: "DELETE" }
      );
      break;
    case "clear-chat":
      await requestDecoded(
        requestor,
        emptyResponseSchema,
        query("/moderation/chat", {
          broadcaster_id: command.channel.id,
          moderator_id: actor.id,
        }),
        { method: "DELETE" }
      );
      break;
    case "update-chat-settings":
      await requestDecoded(
        requestor,
        unknownResponseSchema,
        query("/chat/settings", {
          broadcaster_id: command.channel.id,
          moderator_id: actor.id,
        }),
        { method: "PATCH", body: JSON.stringify(action.settings) }
      );
      break;
    case "send-and-pin":
      {
        const response = await requestDecoded(
          requestor,
          sendChatMessageResponseSchema,
          "/chat/messages",
          {
            method: "POST",
            body: JSON.stringify({
              broadcaster_id: command.channel.id,
              sender_id: actor.id,
              message: action.message,
              pin: true,
            }),
          }
        );
        const sent = response.data?.[0];
        if (!sent?.is_sent) {
          throw new Error(sent?.drop_reason?.message ?? "Twitch declined the pinned message.");
        }
      }
      break;
    case "announce":
      await requestDecoded(
        requestor,
        emptyResponseSchema,
        query("/chat/announcements", {
          broadcaster_id: command.channel.id,
          moderator_id: actor.id,
        }),
        { method: "POST", body: JSON.stringify({ message: action.message }) }
      );
      break;
    case "shoutout":
      await requestDecoded(
        requestor,
        emptyResponseSchema,
        query("/chat/shoutouts", {
          from_broadcaster_id: command.channel.id,
          to_broadcaster_id: resolvedTargetId(target),
          moderator_id: actor.id,
        }),
        { method: "POST" }
      );
      break;
    case "set-suspicious-status":
      await requestDecoded(
        requestor,
        unknownResponseSchema,
        query("/moderation/suspicious_users", {
          broadcaster_id: command.channel.id,
          moderator_id: actor.id,
        }),
        {
          method: "POST",
          body: JSON.stringify({
            user_id: resolvedTargetId(target),
            status: action.status,
          }),
        }
      );
      break;
    case "add-moderator":
    case "remove-moderator":
    case "add-vip":
    case "remove-vip": {
      const moderatorAction = action.kind.endsWith("moderator");
      await requestDecoded(
        requestor,
        emptyResponseSchema,
        query(moderatorAction ? "/moderation/moderators" : "/channels/vips", {
          broadcaster_id: command.channel.id,
          user_id: resolvedTargetId(target),
        }),
        { method: action.kind.startsWith("add-") ? "POST" : "DELETE" }
      );
      break;
    }
    case "run-commercial":
      await requestDecoded(requestor, unknownResponseSchema, "/channels/commercial", {
        method: "POST",
        body: JSON.stringify({ broadcaster_id: command.channel.id, length: action.length }),
      });
      break;
    case "start-raid":
      await requestDecoded(
        requestor,
        unknownResponseSchema,
        query("/raids", {
          from_broadcaster_id: command.channel.id,
          to_broadcaster_id: resolvedTargetId(target),
        }),
        { method: "POST" }
      );
      break;
    case "cancel-raid":
      await requestDecoded(
        requestor,
        emptyResponseSchema,
        query("/raids", { broadcaster_id: command.channel.id }),
        { method: "DELETE" }
      );
      break;
    case "create-stream-marker":
      await requestDecoded(requestor, unknownResponseSchema, "/streams/markers", {
        method: "POST",
        body: JSON.stringify({
          user_id: command.channel.id,
          ...(action.description ? { description: action.description } : {}),
        }),
      });
      break;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }

  return {
    action: action.kind,
    ...(target ? { targetLogin: target.login } : {}),
  };
}
