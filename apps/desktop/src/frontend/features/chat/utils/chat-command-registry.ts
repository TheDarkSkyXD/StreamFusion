import type { TwitchAppScope } from "@shared/auth-types";
import type { ChatPlatform } from "@shared/chat-types";
import type { TwitchSlashCommandAction } from "@shared/twitch-api-types";

export type ChatCommandRole = "viewer" | "moderator" | "broadcaster";
export type ChatCommandAccess =
  | { readonly kind: "guest"; readonly platform: ChatPlatform }
  | {
      readonly kind: "authenticated";
      readonly platform: "twitch";
      readonly role: ChatCommandRole;
    }
  | {
      readonly kind: "authenticated";
      readonly platform: "kick";
      readonly role: ChatCommandRole;
      readonly isPartnerBroadcaster?: boolean;
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

export type TwitchCommandEffect =
  | { readonly kind: "help" }
  | { readonly kind: "irc-action"; readonly message: string }
  | { readonly kind: "disconnect" }
  | { readonly kind: "api"; readonly action: TwitchSlashCommandAction }
  | { readonly kind: "engagement"; readonly section: "polls" | "predictions" }
  | { readonly kind: "channel-members"; readonly list: "moderators" | "vips" }
  | { readonly kind: "local-notice"; readonly message: string };

export interface TwitchCommandDefinition extends ChatCommandMetadata {
  readonly platform: "twitch";
  readonly requiredScopes: readonly TwitchAppScope[];
  readonly compile: (args: string, role: ChatCommandRole) => TwitchCommandEffect;
}

export type KickModerationEffect =
  | {
      readonly kind: "moderation";
      readonly action: "ban";
      readonly targetLogin: string;
      readonly reason?: string;
    }
  | {
      readonly kind: "moderation";
      readonly action: "unban";
      readonly targetLogin: string;
    }
  | {
      readonly kind: "moderation";
      readonly action: "timeout";
      readonly targetLogin: string;
      readonly durationMinutes: number;
      readonly reason?: string;
    };

export type KickCommandEffect =
  | { readonly kind: "help" }
  | { readonly kind: "action-message"; readonly message: string }
  | KickModerationEffect
  | { readonly kind: "local-notice"; readonly message: string };

export interface KickCommandDefinition extends ChatCommandMetadata {
  readonly platform: "kick";
  readonly requiresPartnerChannel: boolean;
  readonly compile: (args: string, role: ChatCommandRole) => KickCommandEffect;
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

interface KickCommandOptions {
  readonly name: string;
  readonly usage: string;
  readonly description: string;
  readonly roles?: readonly ChatCommandRole[];
  readonly execution?: ChatCommandExecution;
  readonly requiresPartnerChannel?: boolean;
  readonly compile: KickCommandDefinition["compile"];
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

function kickCommand(options: KickCommandOptions): KickCommandDefinition {
  return {
    id: `kick-${options.name}`,
    name: options.name,
    usage: options.usage,
    description: options.description,
    platform: "kick",
    allowedRoles: options.roles ?? viewerRoles,
    execution: options.execution ?? "platform-command",
    requiresPartnerChannel: options.requiresPartnerChannel ?? false,
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

function boundedReason(reason: string, command: string, maximum = 500): string | undefined {
  if (!reason) return undefined;
  if (reason.length > maximum) {
    throw new Error(`/${command} reason must be ${maximum} characters or fewer`);
  }
  return reason;
}

function kickToggle(args: string, command: string): { enabled: boolean; rest: string[] } {
  const [rawMode, ...rest] = argumentsList(args);
  const mode = rawMode?.toLowerCase();
  if (mode !== "on" && mode !== "off") {
    throw new Error(`/${command} needs "on" or "off"`);
  }
  return { enabled: mode === "on", rest };
}

function kickPositiveSeconds(rawValue: string | undefined, command: string): number {
  const seconds = Number(rawValue);
  if (!rawValue || !/^\d+$/.test(rawValue) || !Number.isSafeInteger(seconds) || seconds < 1) {
    throw new Error(`/${command} needs a positive whole number of seconds`);
  }
  return seconds;
}

function kickTimeoutMinutes(rawValue: string | undefined): number {
  const seconds = kickPositiveSeconds(rawValue, "timeout");
  if (seconds % 60 !== 0 || seconds > 604_800) {
    throw new Error("/timeout seconds must be a multiple of 60 between 60 and 604800");
  }
  return seconds / 60;
}

function kickChannelHandoff(explanation: string): KickCommandEffect {
  return { kind: "local-notice", message: explanation };
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

function localTwitchNotice(message: string): TwitchCommandDefinition["compile"] {
  return () => ({ kind: "local-notice", message });
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
    compile: (args) => {
      noArguments(args, "mods");
      return { kind: "channel-members", list: "moderators" };
    },
  }),
  twitchCommand({
    name: "vips",
    usage: "/vips",
    description: "Show this channel's VIPs on Twitch",
    compile: (args) => {
      noArguments(args, "vips");
      return { kind: "channel-members", list: "vips" };
    },
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
    description: "Show gift subscription availability",
    compile: (args) => {
      const [quantity, extra] = argumentsList(args);
      if (
        extra ||
        (quantity && (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 100))
      ) {
        throw new Error("/gift quantity must be between 1 and 100");
      }
      return {
        kind: "local-notice",
        message: "Twitch handles gift purchases in its secure subscription flow.",
      };
    },
  }),
  twitchCommand({
    name: "vote",
    usage: "/vote",
    description: "Show poll voting availability",
    compile: (args) => {
      noArguments(args, "vote");
      return {
        kind: "local-notice",
        message: "Twitch does not provide third-party apps an API for casting poll votes.",
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
          kind: "local-notice",
          message:
            "Twitch's public removal endpoint clears either suspicious-user treatment, so StreamFusion does not run this command from chat.",
        };
      },
    })
  ),
  twitchCommand({
    name: "user",
    usage: "/user [username]",
    description: "Show Twitch user-card availability",
    roles: moderatorRoles,
    compile: (args) => {
      requiredUsername(args, "user");
      return {
        kind: "local-notice",
        message: "Twitch keeps the complete viewer card and moderation history in its own UI.",
      };
    },
  }),
  twitchCommand({
    name: "requests",
    usage: "/requests",
    description: "Show Channel Points request availability",
    roles: moderatorRoles,
    compile: localTwitchNotice(
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
      description: `Open ${section} management in StreamFusion`,
      roles: moderatorRoles,
      compile: (_args, role) =>
        role === "broadcaster"
          ? { kind: "engagement", section }
          : {
              kind: "local-notice",
              message: `Twitch's public ${section} mutations require the broadcaster's token, so StreamFusion does not run this moderator command from chat.`,
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
    compile: localTwitchNotice("Twitch does not expose channel rules through its public API."),
  }),
  twitchCommand({
    name: "sharedchat",
    usage: "/sharedchat",
    description: "Show Shared Chat management availability",
    roles: broadcasterRoles,
    compile: localTwitchNotice("Twitch exposes Shared Chat setup only in its own Stream Manager."),
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
    description: "Show creator goal management availability",
    roles: broadcasterRoles,
    compile: localTwitchNotice("Twitch does not provide a public API for changing creator goals."),
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

const KICK_LOCAL_COMMANDS = [
  kickCommand({
    name: "help",
    usage: "/help [command]",
    description: "Show the commands available to you",
    execution: "local",
    compile: () => ({ kind: "help" }),
  }),
  kickCommand({
    name: "me",
    usage: "/me [message]",
    description: "Send an action message",
    execution: "action-message",
    compile: (args) => ({ kind: "action-message", message: requiredMessage(args, "me") }),
  }),
] as const;

const KICK_COMMAND_CATALOG = [
  kickCommand({
    name: "ban",
    usage: "/ban [username] [reason]",
    description: "Permanently ban a user",
    roles: moderatorRoles,
    compile: (args) => {
      const target = requiredUsername(args, "ban");
      const reason = boundedReason(target.rest, "ban", 100);
      return {
        kind: "moderation",
        action: "ban",
        targetLogin: target.login,
        ...(reason ? { reason } : {}),
      };
    },
  }),
  kickCommand({
    name: "unban",
    usage: "/unban [username]",
    description: "Remove a channel ban or timeout",
    roles: moderatorRoles,
    compile: (args) => {
      const target = requiredUsername(args, "unban");
      noArguments(target.rest, "unban");
      return { kind: "moderation", action: "unban", targetLogin: target.login };
    },
  }),
  kickCommand({
    name: "timeout",
    usage: "/timeout [username] [seconds] [reason]",
    description: "Temporarily prevent a user from chatting",
    roles: moderatorRoles,
    compile: (args) => {
      const target = requiredUsername(args, "timeout");
      const [rawDuration, ...reasonParts] = argumentsList(target.rest);
      const reason = boundedReason(reasonParts.join(" "), "timeout", 100);
      return {
        kind: "moderation",
        action: "timeout",
        targetLogin: target.login,
        durationMinutes: kickTimeoutMinutes(rawDuration),
        ...(reason ? { reason } : {}),
      };
    },
  }),
  kickCommand({
    name: "clear",
    usage: "/clear",
    description: "Clear all current chat messages",
    roles: moderatorRoles,
    compile: (args) => {
      noArguments(args, "clear");
      return kickChannelHandoff(
        "Kick does not provide third-party apps a clear-all chat operation."
      );
    },
  }),
  ...(
    [
      ["mod", "Give a user the Moderator role"],
      ["unmod", "Remove a user's Moderator role"],
    ] as const
  ).map(([name, description]) =>
    kickCommand({
      name,
      usage: `/${name} [username]`,
      description,
      roles: broadcasterRoles,
      compile: (args) => {
        const target = requiredUsername(args, name);
        noArguments(target.rest, name);
        return kickChannelHandoff(
          "Kick does not provide third-party apps a Moderator role mutation."
        );
      },
    })
  ),
  kickCommand({
    name: "user",
    usage: "/user [username]",
    description: "Show Kick user information availability",
    roles: moderatorRoles,
    compile: (args) => {
      const target = requiredUsername(args, "user");
      noArguments(target.rest, "user");
      return kickChannelHandoff(
        "Kick exposes the moderation user card only in its first-party channel chat."
      );
    },
  }),
  kickCommand({
    name: "slow",
    usage: "/slow [on|off] [seconds]",
    description: "Enable or disable slow mode",
    roles: moderatorRoles,
    compile: (args) => {
      const toggle = kickToggle(args, "slow");
      if (!toggle.enabled) {
        if (toggle.rest.length > 0) throw new Error("/slow off does not accept a duration");
        return kickChannelHandoff(
          "Kick exposes slow-mode controls only in its first-party channel chat."
        );
      }
      if (toggle.rest.length !== 1) {
        throw new Error("/slow on needs a positive whole number of seconds");
      }
      kickPositiveSeconds(toggle.rest[0], "slow on");
      return kickChannelHandoff(
        "Kick exposes slow-mode controls only in its first-party channel chat."
      );
    },
  }),
  ...(
    [
      ["followonly", "followers-only"],
      ["emoteonly", "emote-only"],
    ] as const
  ).map(([name, mode]) =>
    kickCommand({
      name,
      usage: `/${name} [on|off]`,
      description: `Enable or disable ${mode} mode`,
      roles: moderatorRoles,
      compile: (args) => {
        const toggle = kickToggle(args, name);
        if (toggle.rest.length > 0) throw new Error(`/${name} accepts only "on" or "off"`);
        return kickChannelHandoff(
          `Kick exposes ${mode} controls only in its first-party channel chat.`
        );
      },
    })
  ),
  kickCommand({
    name: "subonly",
    usage: "/subonly [on|off]",
    description: "Enable or disable subscribers-only mode",
    roles: broadcasterRoles,
    compile: (args) => {
      const toggle = kickToggle(args, "subonly");
      if (toggle.rest.length > 0) throw new Error('/subonly accepts only "on" or "off"');
      return kickChannelHandoff(
        "Kick exposes subscribers-only controls only in its first-party channel chat."
      );
    },
  }),
  kickCommand({
    name: "title",
    usage: "/title [new title]",
    description: "Set the current stream title",
    roles: moderatorRoles,
    compile: (args) => {
      requiredMessage(args, "title");
      return kickChannelHandoff(
        "Kick only documents programmatic title changes for the channel owner's token."
      );
    },
  }),
  kickCommand({
    name: "category",
    usage: "/category",
    description: "Show stream category controls availability",
    roles: moderatorRoles,
    compile: (args) => {
      noArguments(args, "category");
      return kickChannelHandoff("Kick's category command uses a first-party interactive selector.");
    },
  }),
  kickCommand({
    name: "raid",
    usage: "/raid",
    description: "Show Kick raid controls availability",
    roles: broadcasterRoles,
    compile: (args) => {
      noArguments(args, "raid");
      return kickChannelHandoff("Kick does not provide third-party apps a raid operation.");
    },
  }),
  ...(
    [
      ["og", "Give a user the OG badge"],
      ["unog", "Remove a user's OG badge"],
      ["vip", "Give a user the VIP badge"],
      ["unvip", "Remove a user's VIP badge"],
    ] as const
  ).map(([name, description]) =>
    kickCommand({
      name,
      usage: `/${name} [username]`,
      description,
      roles: broadcasterRoles,
      compile: (args) => {
        const target = requiredUsername(args, name);
        noArguments(target.rest, name);
        return kickChannelHandoff(
          "Kick does not provide third-party apps an OG or VIP role mutation."
        );
      },
    })
  ),
  ...(
    [
      ["poll", "Open poll creation"],
      ["polldelete", "Delete the active poll"],
      ["prediction", "Open prediction creation or management"],
    ] as const
  ).map(([name, description]) =>
    kickCommand({
      name,
      usage: `/${name}`,
      description,
      roles: moderatorRoles,
      compile: (args) => {
        noArguments(args, name);
        return kickChannelHandoff("Kick exposes this engagement workflow only in its own chat UI.");
      },
    })
  ),
  ...(
    [
      ["multi", "Toggle Kick Partner Multistreaming"],
      ["kpp", "Toggle Kick Partner Program income"],
    ] as const
  ).map(([name, description]) =>
    kickCommand({
      name,
      usage: `/${name} [on|off]`,
      description: `${description}, Partner channels only`,
      roles: broadcasterRoles,
      requiresPartnerChannel: true,
      compile: (args) => {
        const toggle = kickToggle(args, name);
        if (toggle.rest.length > 0) throw new Error(`/${name} accepts only "on" or "off"`);
        return kickChannelHandoff(
          "Kick Partner controls are available only in Kick's first-party UI."
        );
      },
    })
  ),
] as const satisfies readonly KickCommandDefinition[];

export const CHAT_COMMAND_REGISTRY: readonly ChatCommandDefinition[] = [
  ...TWITCH_COMMAND_CATALOG,
  ...TWITCH_LOCAL_COMMANDS,
  ...KICK_LOCAL_COMMANDS,
  ...KICK_COMMAND_CATALOG,
];

export const TWITCH_LINKED_COMMAND_NAMES = TWITCH_COMMAND_CATALOG.map((command) => command.name);
export const KICK_LINKED_COMMAND_NAMES = KICK_COMMAND_CATALOG.map((command) => command.name);

export function compileTwitchCommand(
  command: ParsedChatCommand,
  role: ChatCommandRole
): TwitchCommandEffect {
  if (command.definition.platform !== "twitch") {
    throw new Error(`/${command.definition.name} is not a Twitch command`);
  }
  return command.definition.compile(command.args, role);
}

export function compileKickCommand(
  command: ParsedChatCommand,
  role: ChatCommandRole
): KickCommandEffect {
  if (command.definition.platform !== "kick") {
    throw new Error(`/${command.definition.name} is not a Kick command`);
  }
  return command.definition.compile(command.args, role);
}

export function getCommandsForAccess(access: ChatCommandAccess): readonly CommandSuggestion[] {
  if (access.kind === "guest") return [];
  const commands: CommandSuggestion[] = [];
  for (const command of CHAT_COMMAND_REGISTRY) {
    if (command.platform !== access.platform || !command.allowedRoles.includes(access.role))
      continue;
    if (
      command.platform === "kick" &&
      command.requiresPartnerChannel &&
      !(access.platform === "kick" && access.isPartnerBroadcaster)
    ) {
      continue;
    }
    commands.push({ ...command, key: command.id });
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
  try {
    if (command.definition.platform === "twitch") {
      command.definition.compile(command.args, command.definition.allowedRoles[0] ?? "viewer");
    } else {
      command.definition.compile(command.args, command.definition.allowedRoles[0] ?? "viewer");
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "This command has invalid arguments";
  }
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
