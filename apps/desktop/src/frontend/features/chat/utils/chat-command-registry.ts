import type { ChatPlatform } from "@shared/chat-types";

export type ChatCommandRole = "viewer" | "moderator" | "broadcaster";

export type ChatCommandAccess =
  | { readonly kind: "guest"; readonly platform: ChatPlatform }
  | {
      readonly kind: "authenticated";
      readonly platform: ChatPlatform;
      readonly role: ChatCommandRole;
    };

export type ChatCommandExecution = "local" | "action-message" | "platform-command";

export interface ChatCommandDefinition {
  readonly id: string;
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  readonly platform: ChatPlatform;
  readonly allowedRoles: readonly ChatCommandRole[];
  readonly execution: ChatCommandExecution;
}

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface CommandSuggestion extends ChatCommandDefinition {
  readonly key: string;
}

export interface ParsedChatCommand {
  readonly definition: ChatCommandDefinition;
  readonly args: string;
  readonly text: string;
}

const viewerRoles = ["viewer", "moderator", "broadcaster"] as const;
const moderatorRoles = ["moderator", "broadcaster"] as const;
const broadcasterRoles = ["broadcaster"] as const;

export const CHAT_COMMAND_REGISTRY = [
  {
    id: "twitch-block",
    name: "block",
    usage: "/block [username]",
    description: "Block a user from interacting with you on Twitch",
    platform: "twitch",
    allowedRoles: viewerRoles,
    execution: "platform-command",
  },
  {
    id: "twitch-unblock",
    name: "unblock",
    usage: "/unblock [username]",
    description: "Remove a user from your Twitch block list",
    platform: "twitch",
    allowedRoles: viewerRoles,
    execution: "platform-command",
  },
  {
    id: "twitch-color",
    name: "color",
    usage: "/color [color]",
    description: "Change your Twitch username color",
    platform: "twitch",
    allowedRoles: viewerRoles,
    execution: "platform-command",
  },
  {
    id: "twitch-help",
    name: "help",
    usage: "/help [command]",
    description: "Show the commands available to you",
    platform: "twitch",
    allowedRoles: viewerRoles,
    execution: "local",
  },
  {
    id: "twitch-me",
    name: "me",
    usage: "/me [message]",
    description: "Send an action message",
    platform: "twitch",
    allowedRoles: viewerRoles,
    execution: "action-message",
  },
  {
    id: "twitch-mods",
    name: "mods",
    usage: "/mods",
    description: "Display this channel's moderators",
    platform: "twitch",
    allowedRoles: viewerRoles,
    execution: "platform-command",
  },
  {
    id: "twitch-vips",
    name: "vips",
    usage: "/vips",
    description: "Display this channel's VIPs",
    platform: "twitch",
    allowedRoles: viewerRoles,
    execution: "platform-command",
  },
  {
    id: "twitch-ban",
    name: "ban",
    usage: "/ban [username] [reason]",
    description: "Permanently ban a user",
    platform: "twitch",
    allowedRoles: moderatorRoles,
    execution: "platform-command",
  },
  {
    id: "twitch-unban",
    name: "unban",
    usage: "/unban [username]",
    description: "Remove a channel ban",
    platform: "twitch",
    allowedRoles: moderatorRoles,
    execution: "platform-command",
  },
  {
    id: "twitch-timeout",
    name: "timeout",
    usage: "/timeout [username] [seconds] [reason]",
    description: "Temporarily timeout a user",
    platform: "twitch",
    allowedRoles: moderatorRoles,
    execution: "platform-command",
  },
  {
    id: "twitch-clear",
    name: "clear",
    usage: "/clear",
    description: "Clear the channel's chat history",
    platform: "twitch",
    allowedRoles: moderatorRoles,
    execution: "platform-command",
  },
  ...(
    [
      ["slow", "/slow [seconds]", "Enable slow mode"],
      ["slowoff", "/slowoff", "Disable slow mode"],
      ["followers", "/followers [minutes]", "Enable followers-only mode"],
      ["followersoff", "/followersoff", "Disable followers-only mode"],
      ["subscribers", "/subscribers", "Enable subscribers-only mode"],
      ["subscribersoff", "/subscribersoff", "Disable subscribers-only mode"],
      ["uniquechat", "/uniquechat", "Require unique chat messages"],
      ["uniquechatoff", "/uniquechatoff", "Disable unique chat mode"],
      ["emoteonly", "/emoteonly", "Enable emote-only mode"],
      ["emoteonlyoff", "/emoteonlyoff", "Disable emote-only mode"],
    ] as const
  ).map(([name, usage, description]) => ({
    id: `twitch-${name}`,
    name,
    usage,
    description,
    platform: "twitch" as const,
    allowedRoles: moderatorRoles,
    execution: "platform-command" as const,
  })),
  {
    id: "kick-help",
    name: "help",
    usage: "/help",
    description: "Show the commands available to you",
    platform: "kick",
    allowedRoles: viewerRoles,
    execution: "local",
  },
  {
    id: "kick-me",
    name: "me",
    usage: "/me [message]",
    description: "Send an action message",
    platform: "kick",
    allowedRoles: viewerRoles,
    execution: "action-message",
  },
  {
    id: "kick-ban",
    name: "ban",
    usage: "/ban [username]",
    description: "Permanently ban a user",
    platform: "kick",
    allowedRoles: moderatorRoles,
    execution: "platform-command",
  },
  {
    id: "kick-unban",
    name: "unban",
    usage: "/unban [username]",
    description: "Remove a channel ban",
    platform: "kick",
    allowedRoles: moderatorRoles,
    execution: "platform-command",
  },
  {
    id: "kick-timeout",
    name: "timeout",
    usage: "/timeout [username] [seconds]",
    description: "Temporarily timeout a user",
    platform: "kick",
    allowedRoles: moderatorRoles,
    execution: "platform-command",
  },
  ...(
    [
      ["slow", "/slow [on|off] [seconds]", "Enable or disable slow mode"],
      ["followonly", "/followonly [on|off]", "Enable or disable followers-only mode"],
      ["emoteonly", "/emoteonly [on|off]", "Enable or disable emote-only mode"],
    ] as const
  ).map(([name, usage, description]) => ({
    id: `kick-${name}`,
    name,
    usage,
    description,
    platform: "kick" as const,
    allowedRoles: moderatorRoles,
    execution: "platform-command" as const,
  })),
  {
    id: "kick-subonly",
    name: "subonly",
    usage: "/subonly [on|off]",
    description: "Enable or disable subscribers-only mode",
    platform: "kick",
    allowedRoles: broadcasterRoles,
    execution: "platform-command",
  },
] as const satisfies readonly ChatCommandDefinition[];

export function getCommandsForAccess(access: ChatCommandAccess): readonly CommandSuggestion[] {
  if (access.kind === "guest") return [];

  return CHAT_COMMAND_REGISTRY.filter(
    (command) =>
      command.platform === access.platform &&
      command.allowedRoles.some((role) => role === access.role)
  ).map((command) => ({ ...command, key: command.id }));
}

export function getCommandCompletion(
  value: string,
  cursorPosition: number,
  commands: readonly CommandSuggestion[]
): { readonly range: TextRange; readonly items: readonly CommandSuggestion[] } | null {
  if (cursorPosition < 1 || value[0] !== "/") return null;
  const firstWhitespace = value.search(/\s/);
  const tokenEnd = firstWhitespace === -1 ? value.length : firstWhitespace;
  if (cursorPosition > tokenEnd) return null;

  const prefix = value.slice(1, cursorPosition).toLowerCase();
  return {
    range: { start: 0, end: tokenEnd },
    items: commands.filter((command) => command.name.startsWith(prefix)),
  };
}

export function parseAvailableCommand(
  value: string,
  commands: readonly CommandSuggestion[]
): ParsedChatCommand | null {
  if (!value.startsWith("/")) return null;
  const [token, ...args] = value.trim().slice(1).split(/\s+/);
  if (!token) return null;
  const definition = commands.find((command) => command.name === token.toLowerCase());
  if (!definition) return null;

  return {
    definition,
    args: args.join(" "),
    text: value.trim(),
  };
}

export function replaceLeadingCommand(
  value: string,
  range: TextRange,
  commandName: string
): string {
  return `${value.slice(0, range.start)}/${commandName} ${value.slice(range.end).replace(/^\s/, "")}`;
}
