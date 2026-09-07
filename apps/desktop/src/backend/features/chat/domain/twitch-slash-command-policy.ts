import type { TwitchSlashCommandAction } from "@shared/twitch-api-types";

export function targetLoginForAction(action: TwitchSlashCommandAction): string | null {
  switch (action.kind) {
    case "whisper":
    case "block":
    case "unblock":
    case "ban":
    case "timeout":
    case "unban":
    case "shoutout":
    case "set-suspicious-status":
    case "add-moderator":
    case "remove-moderator":
    case "add-vip":
    case "remove-vip":
    case "start-raid":
      return action.targetLogin;
    case "update-chat-color":
    case "clear-chat":
    case "update-chat-settings":
    case "send-and-pin":
    case "announce":
    case "run-commercial":
    case "cancel-raid":
    case "create-stream-marker":
      return null;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function requiresBroadcasterIdentity(action: TwitchSlashCommandAction): boolean {
  switch (action.kind) {
    case "add-moderator":
    case "remove-moderator":
    case "add-vip":
    case "remove-vip":
    case "run-commercial":
    case "start-raid":
    case "cancel-raid":
      return true;
    case "update-chat-color":
    case "whisper":
    case "block":
    case "unblock":
    case "ban":
    case "timeout":
    case "unban":
    case "clear-chat":
    case "update-chat-settings":
    case "send-and-pin":
    case "announce":
    case "shoutout":
    case "set-suspicious-status":
    case "create-stream-marker":
      return false;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function requireSlashCommandActor(
  action: TwitchSlashCommandAction,
  actorId: string,
  channelId: string
): void {
  if (requiresBroadcasterIdentity(action) && actorId !== channelId) {
    throw new Error("This Twitch action requires the broadcaster's signed-in account.");
  }
}
