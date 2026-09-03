import type {
  TwitchApiCommand,
  TwitchApiResult,
  TwitchChannelMember,
} from "@shared/twitch-api-types";

import { i18n } from "@/i18n";

import type {
  ChatCommandRole,
  TwitchCommandDefinition,
  TwitchCommandEffect,
} from "./chat-command-registry";
import {
  HANDLED_CHAT_COMMAND,
  localChatCommandResult,
  type ChatCommandOutcome,
} from "./chat-command-outcome";

type TwitchChannelMembersPage = {
  readonly data: readonly TwitchChannelMember[];
  readonly pagination: { readonly cursor?: string };
};

interface TwitchCommandSessionDependencies {
  readonly channel: { readonly id: string; readonly login: string };
  readonly role: ChatCommandRole;
  readonly grantedScopes: readonly string[];
  readonly sendAction: (message: string) => Promise<void>;
  readonly leaveChannel: () => Promise<void>;
  readonly executeApi: (
    command: Extract<TwitchApiCommand, { operation: "execute-slash-command" }>
  ) => Promise<TwitchApiResult>;
  readonly readChannelMembers: (list: "moderators" | "vips") => Promise<TwitchApiResult<unknown>>;
  readonly openEngagement: (section: "polls" | "predictions") => void;
  readonly requestReconnect: (missingScopes: readonly string[]) => void;
}

function formatChannelMembers(list: "moderators" | "vips", page: TwitchChannelMembersPage): string {
  const label = i18n.t(list === "moderators" ? "chatCommand.moderators" : "chatCommand.vips");
  if (page.data.length === 0) {
    return i18n.t(list === "moderators" ? "chatCommand.noModerators" : "chatCommand.noVips");
  }
  const names = page.data.map((member) => member.user_name || member.user_login).join(", ");
  return i18n.t(page.pagination.cursor ? "chatCommand.firstHundred" : "chatCommand.memberList", {
    label,
    names,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isChannelMember(value: unknown): value is TwitchChannelMember {
  return (
    isRecord(value) &&
    typeof value.user_id === "string" &&
    typeof value.user_login === "string" &&
    typeof value.user_name === "string"
  );
}

function isChannelMembersPage(value: unknown): value is TwitchChannelMembersPage {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.data) || !value.data.every(isChannelMember)) return false;
  if (!isRecord(value.pagination)) return false;
  return value.pagination.cursor === undefined || typeof value.pagination.cursor === "string";
}

export async function runTwitchCommandEffect(
  definition: TwitchCommandDefinition,
  args: string,
  dependencies: TwitchCommandSessionDependencies
): Promise<ChatCommandOutcome> {
  const effect: TwitchCommandEffect = definition.compile(args, dependencies.role);
  const missingScopes = definition.requiredScopes.filter(
    (scope) => !dependencies.grantedScopes.includes(scope)
  );
  if (missingScopes.length > 0) {
    dependencies.requestReconnect(missingScopes);
    throw new Error(i18n.t("chatCommand.reconnectTwitch", { command: definition.name }));
  }

  switch (effect.kind) {
    case "help":
      throw new Error(i18n.t("chatCommand.helpHandledByComposer"));
    case "irc-action":
      await dependencies.sendAction(effect.message);
      return HANDLED_CHAT_COMMAND;
    case "disconnect":
      await dependencies.leaveChannel();
      return HANDLED_CHAT_COMMAND;
    case "engagement":
      dependencies.openEngagement(effect.section);
      return HANDLED_CHAT_COMMAND;
    case "channel-members": {
      const result = await dependencies.readChannelMembers(effect.list);
      const title = i18n.t(
        effect.list === "moderators" ? "chatCommand.channelModerators" : "chatCommand.channelVips"
      );
      if (result.ok) {
        if (!isChannelMembersPage(result.data)) {
          return localChatCommandResult({
            tone: "error",
            title,
            body: i18n.t("chatCommand.unexpectedMemberList"),
          });
        }
        return localChatCommandResult({
          tone: "info",
          title,
          body: formatChannelMembers(effect.list, result.data),
        });
      }
      return localChatCommandResult({
        tone: "error",
        title,
        body: result.error.message,
      });
    }
    case "local-notice": {
      return localChatCommandResult({
        tone: "info",
        title: `/${definition.name}`,
        body: effect.message,
      });
    }
    case "api": {
      const result = await dependencies.executeApi({
        operation: "execute-slash-command",
        channel: dependencies.channel,
        action: effect.action,
      });
      if (!result.ok) throw new Error(result.error.message);
      return HANDLED_CHAT_COMMAND;
    }
    default: {
      const exhaustive: never = effect;
      return exhaustive;
    }
  }
}
