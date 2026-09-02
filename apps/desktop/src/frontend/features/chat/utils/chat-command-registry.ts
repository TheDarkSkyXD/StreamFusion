import type { TwitchAppScope } from "@shared/auth-types";
import type { ChatPlatform } from "@shared/chat-types";
import type { TwitchSlashCommandAction } from "@shared/twitch-api-types";

export type ChatCommandRole = "viewer" | "moderator" | "broadcaster";
export type ChatCommandAccess =
  | { readonly kind: "guest"; readonly platform: ChatPlatform }
  | {
      readonly kind: "authenticated";
      readonly platform: ChatPlatform;
      readonly role: ChatCommandRole;
    };
export type ChatCommandExecution = "local" | "action-message" | "platform-command";

interface ChatCommandMetadata {
  readonly id: string;
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  readonly allowedRoles: readonly ChatCommandRole[];
  readonly execution: ChatCommandExecution;
}

export type TwitchFirstPartyDestination =
  | { readonly kind: "channel-chat" }
  | { readonly kind: "subscriptions" }
  | { readonly kind: "user"; readonly login: string }
  | { readonly kind: "stream-manager" };

export type TwitchCommandEffect =
  | { readonly kind: "help" }
  | { readonly kind: "irc-action"; readonly message: string }
  | { readonly kind: "disconnect" }
  | { readonly kind: "api"; readonly action: TwitchSlashCommandAction }
  | { readonly kind: "engagement"; readonly section: "polls" | "predictions" }
  | {
      readonly kind: "first-party";
      readonly destination: TwitchFirstPartyDestination;
      readonly explanation: string;
    };

export interface TwitchCommandDefinition extends ChatCommandMetadata {
  readonly platform: "twitch";
  readonly requiredScopes: readonly TwitchAppScope[];
  readonly compile: (args: string, role: ChatCommandRole) => TwitchCommandEffect;
}
export interface KickCommandDefinition extends ChatCommandMetadata {
  readonly platform: "kick";
}
export type ChatCommandDefinition = TwitchCommandDefinition | KickCommandDefinition;
export interface TextRange {
  readonly start: number;
  readonly end: number;
}
export type CommandSuggestion = ChatCommandDefinition & { readonly key: string };
export interface ParsedChatCommand {
  readonly definition: ChatCommandDefinition;
  readonly args: string;
  readonly text: string;
}

interface TwitchCommandOptions {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  readonly roles?: readonly ChatCommandRole[];
  readonly scopes?: readonly TwitchAppScope[];
  readonly execution?: ChatCommandExecution;
  readonly compile: TwitchCommandDefinition["compile"];
}

const viewerRoles = ["viewer", "moderator", "broadcaster"] as const;
const moderatorRoles = ["moderator", "broadcaster"] as const;
const broadcasterRoles = ["broadcaster"] as const;

function twitchCommand(options: TwitchCommandOptions): TwitchCommandDefinition {
  return {
    id: `twitch-${options.name}`,
    name: options.name,
    usage: options.usage,
    description: options.description,
    platform: "twitch",
    allowedRoles: options.roles ?? viewerRoles,
    requiredScopes: options.scopes ?? [],
    execution: options.execution ?? "platform-command",
    compile: options.compile,
  };
}

function argumentsList(args: string): string[] {
  return args.trim() ? args.trim().split(/\s+/) : [];
}

function requiredUsername(args: string, command: string): { login: string; rest: string } {
  const [rawLogin, ...rest] = argumentsList(args);
  const login = rawLogin?.replace(/^@+/, "");
  if (!login) throw new Error(`/${command} needs a username`);
  if (!/^[a-zA-Z0-9_]{1,25}$/.test(login)) {
    throw new Error(`/${command} needs a valid username`);
  }
  return { login, rest: rest.join(" ") };
}

function requiredMessage(args: string, command: string, maximum = 500): string {
  const message = args.trim();
  if (!message) throw new Error(`/${command} needs a message`);
  if (message.length > maximum) {
    throw new Error(`/${command} message must be ${maximum} characters or fewer`);
  }
  return message;
}

function noArguments(args: string, command: string): void {
  if (args.trim()) throw new Error(`/${command} does not accept arguments`);
}

function boundedReason(reason: string, command: string): string | undefined {
  if (!reason) return undefined;
  if (reason.length > 500) throw new Error(`/${command} reason must be 500 characters or fewer`);
  return reason;
}

const TWITCH_CHAT_COLORS: Readonly<Record<string, string>> = {
  blue: "blue",
  blueviolet: "blue_violet",
  cadetblue: "cadet_blue",
  chocolate: "chocolate",
  coral: "coral",
  dodgerblue: "dodger_blue",
  firebrick: "firebrick",
  goldenrod: "golden_rod",
  green: "green",
  hotpink: "hot_pink",
  orangered: "orange_red",
  red: "red",
  seagreen: "sea_green",
  springgreen: "spring_green",
  yellowgreen: "yellow_green",
};

function twitchChatColor(args: string): string {
  const color = requiredMessage(args, "color", 32);
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toUpperCase();
  const key = color.toLowerCase().replace(/[_-]/g, "");
  const namedColor = TWITCH_CHAT_COLORS[key];
  if (!namedColor) throw new Error("/color needs a supported Twitch color or six-digit hex value");
  return namedColor;
}

type TargetActionKind = Extract<
  TwitchSlashCommandAction["kind"],
  | "block"
  | "unblock"
  | "unban"
  | "shoutout"
  | "add-moderator"
  | "remove-moderator"
  | "add-vip"
  | "remove-vip"
>;

function apiTargetCommand(
  kind: TargetActionKind,
  command: string = kind
): TwitchCommandDefinition["compile"] {
  return (args) => ({
    kind: "api",
    action: { kind, targetLogin: requiredUsername(args, command).login },
  });
}

function firstParty(
  destination: TwitchFirstPartyDestination,
  explanation: string
): TwitchCommandDefinition["compile"] {
  return () => ({ kind: "first-party", destination, explanation });
}

function followersMinutes(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(\d+)(m|h|d|w|mo)?$/i.exec(value);
  if (!match) {
    throw new Error("/followers duration must use minutes, hours, days, weeks, or months");
  }
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? "m";
  const multiplier = { m: 1, h: 60, d: 1_440, w: 10_080, mo: 43_200 }[unit] ?? 1;
  const minutes = amount * multiplier;
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 129_600) {
    throw new Error("/followers duration must be between 0 and 129600 minutes");
  }
  return minutes;
}

function boundedInteger(
  rawValue: string | undefined,
  options: { command: string; defaultValue: number; minimum: number; maximum: number }
): number {
  const value = rawValue ?? String(options.defaultValue);
  const parsed = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed < options.minimum ||
    parsed > options.maximum
  ) {
    throw new Error(
      `/${options.command} duration must be between ${options.minimum} and ${options.maximum} seconds`
    );
  }
  return parsed;
}

type CommercialLength = Extract<TwitchSlashCommandAction, { kind: "run-commercial" }>["length"];

function commercialLength(rawValue: string | undefined): CommercialLength {
  const value = boundedInteger(rawValue, {
    command: "commercial",
    defaultValue: 30,
    minimum: 30,
    maximum: 180,
  });
  switch (value) {
    case 30:
    case 60:
    case 90:
    case 120:
    case 150:
    case 180:
      return value;
    default:
      throw new Error("/commercial length must be 30, 60, 90, 120, 150, or 180 seconds");
  }
}

const TWITCH_COMMAND_CATALOG = [
  twitchCommand({
    name: "mods",
    usage: "/mods",
    description: "Show this channel's moderators on Twitch",
    compile: firstParty(
      { kind: "channel-chat" },
      "Twitch only exposes another channel's moderator list in its own chat."
    ),
  }),
  twitchCommand({
    name: "vips",
    usage: "/vips",
    description: "Show this channel's VIPs on Twitch",
    compile: firstParty(
      { kind: "channel-chat" },
      "Twitch only exposes another channel's VIP list in its own chat."
    ),
  }),
  twitchCommand({
    name: "color",
    usage: "/color [color]",
    description: "Change your Twitch username color",
    scopes: ["user:manage:chat_color"],
    compile: (args) => ({
      kind: "api",
      action: { kind: "update-chat-color", color: twitchChatColor(args) },
    }),
  }),
  twitchCommand({
    name: "w",
    usage: "/w [username] [message]",
    description: "Whisper another Twitch user",
    scopes: ["user:manage:whispers"],
    compile: (args) => {
      const target = requiredUsername(args, "w");
      return {
        kind: "api",
        action: {
          kind: "whisper",
          targetLogin: target.login,
          message: requiredMessage(target.rest, "w"),
        },
      };
    },
  }),
  twitchCommand({
    name: "block",
    usage: "/block [username]",
    description: "Block a Twitch user",
    scopes: ["user:manage:blocked_users"],
    compile: apiTargetCommand("block"),
  }),
  twitchCommand({
    name: "unblock",
    usage: "/unblock [username]",
    description: "Unblock a Twitch user",
    scopes: ["user:manage:blocked_users"],
    compile: apiTargetCommand("unblock"),
  }),
  twitchCommand({
    name: "disconnect",
    usage: "/disconnect",
    description: "Leave this channel's chat",
    compile: (args) => {
      noArguments(args, "disconnect");
      return { kind: "disconnect" };
    },
  }),
  twitchCommand({
    name: "gift",
    usage: "/gift [quantity]",
    description: "Open Twitch's gift subscription flow",
    compile: (args) => {
      const [quantity, extra] = argumentsList(args);
      if (
        extra ||
        (quantity && (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 100))
      ) {
        throw new Error("/gift quantity must be between 1 and 100");
      }
      return {
        kind: "first-party",
        destination: { kind: "subscriptions" },
        explanation: "Twitch handles gift purchases in its secure subscription flow.",
      };
    },
  }),
  twitchCommand({
    name: "vote",
    usage: "/vote",
    description: "Open Twitch chat to vote in the current poll",
    compile: (args) => {
      noArguments(args, "vote");
      return {
        kind: "first-party",
        destination: { kind: "channel-chat" },
        explanation: "Twitch does not provide third-party apps an API for casting poll votes.",
      };
    },
  }),
  twitchCommand({
    name: "timeout",
    usage: "/timeout [username] [seconds] [reason]",
    description: "Temporarily timeout a user",
    roles: moderatorRoles,
    scopes: ["moderator:manage:banned_users"],
    compile: (args) => {
      const target = requiredUsername(args, "timeout");
      const [duration, ...reason] = argumentsList(target.rest);
      const normalizedReason = boundedReason(reason.join(" "), "timeout");
      return {
        kind: "api",
        action: {
          kind: "timeout",
          targetLogin: target.login,
          durationSeconds: boundedInteger(duration, {
            command: "timeout",
            defaultValue: 600,
            minimum: 1,
            maximum: 1_209_600,
          }),
          ...(normalizedReason ? { reason: normalizedReason } : {}),
        },
      };
    },
  }),
  twitchCommand({
    name: "ban",
    usage: "/ban [username] [reason]",
    description: "Permanently ban a user",
    roles: moderatorRoles,
    scopes: ["moderator:manage:banned_users"],
    compile: (args) => {
      const target = requiredUsername(args, "ban");
      const reason = boundedReason(target.rest, "ban");
      return {
        kind: "api",
        action: {
          kind: "ban",
          targetLogin: target.login,
          ...(reason ? { reason } : {}),
        },
      };
    },
  }),
  twitchCommand({
    name: "unban",
    usage: "/unban [username]",
    description: "Remove a channel ban or timeout",
    roles: moderatorRoles,
    scopes: ["moderator:manage:banned_users"],
    compile: apiTargetCommand("unban"),
  }),
  twitchCommand({
    name: "clear",
    usage: "/clear",
    description: "Clear the channel's chat history",
    roles: moderatorRoles,
    scopes: ["moderator:manage:chat_messages"],
    compile: (args) => {
      noArguments(args, "clear");
      return { kind: "api", action: { kind: "clear-chat" } };
    },
  }),
  twitchCommand({
    name: "followers",
    usage: "/followers [30m|2h|2d|1w|3mo]",
    description: "Enable followers-only mode",
    roles: moderatorRoles,
    scopes: ["moderator:manage:chat_settings"],
    compile: (args) => {
      const [duration, extra] = argumentsList(args);
      if (extra) throw new Error("/followers accepts one duration");
      return {
        kind: "api",
        action: {
          kind: "update-chat-settings",
          settings: { follower_mode: true, follower_mode_duration: followersMinutes(duration) },
        },
      };
    },
  }),
  twitchCommand({
    name: "followersoff",
    usage: "/followersoff",
    description: "Disable followers-only mode",
    roles: moderatorRoles,
    scopes: ["moderator:manage:chat_settings"],
    compile: (args) => {
      noArguments(args, "followersoff");
      return {
        kind: "api",
        action: { kind: "update-chat-settings", settings: { follower_mode: false } },
      };
    },
  }),
  twitchCommand({
    name: "slow",
    usage: "/slow [seconds]",
    description: "Enable slow mode",
    roles: moderatorRoles,
    scopes: ["moderator:manage:chat_settings"],
    compile: (args) => {
      const [duration, extra] = argumentsList(args);
      if (extra) throw new Error("/slow accepts one duration");
      return {
        kind: "api",
        action: {
          kind: "update-chat-settings",
          settings: {
            slow_mode: true,
            slow_mode_wait_time: boundedInteger(duration, {
              command: "slow",
              defaultValue: 30,
              minimum: 3,
              maximum: 120,
            }),
          },
        },
      };
    },
  }),
  twitchCommand({
    name: "slowoff",
    usage: "/slowoff",
    description: "Disable slow mode",
    roles: moderatorRoles,
    scopes: ["moderator:manage:chat_settings"],
    compile: (args) => {
      noArguments(args, "slowoff");
      return {
        kind: "api",
        action: { kind: "update-chat-settings", settings: { slow_mode: false } },
      };
    },
  }),
  ...(
    [
      ["subscribers", "subscriber_mode", true, "Enable subscribers-only mode"],
      ["subscribersoff", "subscriber_mode", false, "Disable subscribers-only mode"],
      ["emoteonly", "emote_mode", true, "Enable emote-only mode"],
      ["emoteonlyoff", "emote_mode", false, "Disable emote-only mode"],
      ["uniquechat", "unique_chat_mode", true, "Require unique chat messages"],
      ["uniquechatoff", "unique_chat_mode", false, "Disable unique chat mode"],
    ] as const
  ).map(([name, setting, enabled, description]) =>
    twitchCommand({
      name,
      usage: `/${name}`,
      description,
      roles: moderatorRoles,
      scopes: ["moderator:manage:chat_settings"],
      compile: (args) => {
        noArguments(args, name);
        return {
          kind: "api",
          action: { kind: "update-chat-settings", settings: { [setting]: enabled } },
        };
      },
    })
  ),
  twitchCommand({
    name: "pin",
    usage: "/pin [description]",
    description: "Send and pin a chat message",
    roles: moderatorRoles,
    scopes: ["user:write:chat", "moderator:manage:chat_messages"],
    compile: (args) => ({
      kind: "api",
      action: { kind: "send-and-pin", message: requiredMessage(args, "pin") },
    }),
  }),
  twitchCommand({
    name: "announce",
    usage: "/announce [description]",
    description: "Send a highlighted announcement",
    roles: moderatorRoles,
    scopes: ["moderator:manage:announcements"],
    compile: (args) => ({
      kind: "api",
      action: { kind: "announce", message: requiredMessage(args, "announce") },
    }),
  }),
  twitchCommand({
    name: "shoutout",
    usage: "/shoutout [username]",
    description: "Shout out another channel",
    roles: moderatorRoles,
    scopes: ["moderator:manage:shoutouts"],
    compile: apiTargetCommand("shoutout"),
  }),
  ...(
    [
      ["monitor", "ACTIVE_MONITORING"],
      ["restrict", "RESTRICTED"],
    ] as const
  ).map(([name, status]) =>
    twitchCommand({
      name,
      usage: `/${name} [username]`,
      description: `Set a user's ${name} status`,
      roles: moderatorRoles,
      scopes: ["moderator:manage:suspicious_users"],
      compile: (args) => ({
        kind: "api",
        action: {
          kind: "set-suspicious-status",
          targetLogin: requiredUsername(args, name).login,
          status,
        },
      }),
    })
  ),
  ...(["unmonitor", "unrestrict"] as const).map((name) =>
    twitchCommand({
      name,
      usage: `/${name} [username]`,
      description: "Remove a user's suspicious-user treatment",
      roles: moderatorRoles,
      compile: (args) => {
        requiredUsername(args, name);
        return {
          kind: "first-party",
          destination: { kind: "channel-chat" },
          explanation:
            "Twitch's public removal endpoint clears either suspicious-user treatment, so this command opens Twitch chat to preserve the other status.",
        };
      },
    })
  ),
  twitchCommand({
    name: "user",
    usage: "/user [username]",
    description: "Open a Twitch user's profile and moderation tools",
    roles: moderatorRoles,
    compile: (args) => ({
      kind: "first-party",
      destination: { kind: "user", login: requiredUsername(args, "user").login },
      explanation: "Twitch keeps the complete viewer card and moderation history in its own UI.",
    }),
  }),
  twitchCommand({
    name: "requests",
    usage: "/requests",
    description: "Open the Channel Points request queue",
    roles: moderatorRoles,
    compile: firstParty(
      { kind: "channel-chat" },
      "Twitch exposes the native Channel Points request command in its own chat."
    ),
  }),
  ...(
    [
      ["poll", "polls"],
      ["endpoll", "polls"],
      ["deletepoll", "polls"],
      ["prediction", "predictions"],
    ] as const
  ).map(([name, section]) =>
    twitchCommand({
      name,
      usage: `/${name}`,
      description: `Open ${section} management`,
      roles: moderatorRoles,
      compile: (_args, role) =>
        role === "broadcaster"
          ? { kind: "engagement", section }
          : {
              kind: "first-party",
              destination: { kind: "channel-chat" },
              explanation: `Twitch's public ${section} mutations require the broadcaster's token, so moderator management opens the channel's Twitch chat.`,
            },
    })
  ),
  ...(
    [
      ["mod", "add-moderator", "Add a channel moderator"],
      ["unmod", "remove-moderator", "Remove a channel moderator"],
      ["vip", "add-vip", "Add a channel VIP"],
      ["unvip", "remove-vip", "Remove a channel VIP"],
    ] as const
  ).map(([name, kind, description]) =>
    twitchCommand({
      name,
      usage: `/${name} [username]`,
      description,
      roles: broadcasterRoles,
      scopes: [kind.includes("moderator") ? "channel:manage:moderators" : "channel:manage:vips"],
      compile: apiTargetCommand(kind, name),
    })
  ),
  twitchCommand({
    name: "rules",
    usage: "/rules",
    description: "Show this channel's chat rules",
    roles: broadcasterRoles,
    compile: firstParty(
      { kind: "channel-chat" },
      "Twitch does not expose channel rules through its public API."
    ),
  }),
  twitchCommand({
    name: "sharedchat",
    usage: "/sharedchat",
    description: "Open Shared Chat management",
    roles: broadcasterRoles,
    compile: firstParty(
      { kind: "stream-manager" },
      "Twitch exposes Shared Chat setup only in its own Stream Manager."
    ),
  }),
  twitchCommand({
    name: "commercial",
    usage: "/commercial [30|60|90|120|150|180]",
    description: "Run a commercial break",
    roles: broadcasterRoles,
    scopes: ["channel:edit:commercial"],
    compile: (args) => {
      const [rawLength, extra] = argumentsList(args);
      if (extra) {
        throw new Error("/commercial length must be 30, 60, 90, 120, 150, or 180 seconds");
      }
      const length = commercialLength(rawLength);
      return {
        kind: "api",
        action: {
          kind: "run-commercial",
          length,
        },
      };
    },
  }),
  twitchCommand({
    name: "goal",
    usage: "/goal",
    description: "Open creator goal management",
    roles: broadcasterRoles,
    compile: firstParty(
      { kind: "stream-manager" },
      "Twitch does not provide a public API for changing creator goals."
    ),
  }),
  twitchCommand({
    name: "raid",
    usage: "/raid [channel]",
    description: "Start a raid",
    roles: broadcasterRoles,
    scopes: ["channel:manage:raids"],
    compile: (args) => ({
      kind: "api",
      action: { kind: "start-raid", targetLogin: requiredUsername(args, "raid").login },
    }),
  }),
  twitchCommand({
    name: "unraid",
    usage: "/unraid",
    description: "Cancel a pending raid",
    roles: broadcasterRoles,
    scopes: ["channel:manage:raids"],
    compile: (args) => {
      noArguments(args, "unraid");
      return { kind: "api", action: { kind: "cancel-raid" } };
    },
  }),
  twitchCommand({
    name: "marker",
    usage: "/marker [description]",
    description: "Create a stream marker",
    roles: broadcasterRoles,
    scopes: ["channel:manage:broadcast"],
    compile: (args) => {
      const description = args.trim();
      if (description.length > 140) {
        throw new Error("/marker description must be 140 characters or fewer");
      }
      return {
        kind: "api",
        action: { kind: "create-stream-marker", ...(description ? { description } : {}) },
      };
    },
  }),
] as const satisfies readonly TwitchCommandDefinition[];

const TWITCH_LOCAL_COMMANDS = [
  twitchCommand({
    name: "help",
    usage: "/help [command]",
    description: "Show the commands available to you",
    execution: "local",
    compile: () => ({ kind: "help" }),
  }),
  twitchCommand({
    name: "me",
    usage: "/me [message]",
    description: "Send an action message",
    scopes: ["chat:edit"],
    execution: "action-message",
    compile: (args) => ({ kind: "irc-action", message: requiredMessage(args, "me") }),
  }),
] as const;

const KICK_COMMANDS = [
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
] as const satisfies readonly KickCommandDefinition[];

export const CHAT_COMMAND_REGISTRY: readonly ChatCommandDefinition[] = [
  ...TWITCH_COMMAND_CATALOG,
  ...TWITCH_LOCAL_COMMANDS,
  ...KICK_COMMANDS,
];

export const TWITCH_LINKED_COMMAND_NAMES = TWITCH_COMMAND_CATALOG.map((command) => command.name);

export function compileTwitchCommand(
  command: ParsedChatCommand,
  role: ChatCommandRole
): TwitchCommandEffect {
  if (command.definition.platform !== "twitch") {
    throw new Error(`/${command.definition.name} is not a Twitch command`);
  }
  return command.definition.compile(command.args, role);
}

export function getCommandsForAccess(access: ChatCommandAccess): readonly CommandSuggestion[] {
  if (access.kind === "guest") return [];
  const commands: CommandSuggestion[] = [];
  for (const command of CHAT_COMMAND_REGISTRY) {
    if (command.platform === access.platform && command.allowedRoles.includes(access.role)) {
      commands.push({ ...command, key: command.id });
    }
  }
  return commands;
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
  return definition ? { definition, args: args.join(" "), text: value.trim() } : null;
}

export function getCommandArgumentError(command: ParsedChatCommand): string | null {
  if (command.definition.platform === "twitch") {
    try {
      command.definition.compile(command.args, command.definition.allowedRoles[0] ?? "viewer");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "This command has invalid arguments";
    }
  }
  const args = argumentsList(command.args);
  if (command.definition.name === "me" && args.length < 1) return "/me needs a message";
  if (["ban", "unban"].includes(command.definition.name) && args.length < 1) {
    return `/${command.definition.name} needs a username`;
  }
  if (command.definition.name === "timeout") {
    if (args.length < 2) {
      return "/timeout needs a username and a positive number of seconds";
    }
    if (!/^\d+$/.test(args[1] ?? "") || Number(args[1]) < 1) {
      return "/timeout duration must be a positive whole number of seconds";
    }
  }
  if (
    ["slow", "followonly", "emoteonly", "subonly"].includes(command.definition.name) &&
    args.length < 1
  ) {
    return `/${command.definition.name} needs "on" or "off"`;
  }
  return null;
}

export function replaceLeadingCommand(
  value: string,
  range: TextRange,
  commandName: string
): string {
  return `${value.slice(0, range.start)}/${commandName} ${value
    .slice(range.end)
    .replace(/^\s/, "")}`;
}
