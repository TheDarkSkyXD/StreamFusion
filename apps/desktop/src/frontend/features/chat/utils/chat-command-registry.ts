import { i18n } from "@/i18n";
import type { TwitchAppScope } from "@shared/auth-types";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
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
  readonly description: () => string;
  readonly roles?: readonly ChatCommandRole[];
  readonly scopes?: readonly TwitchAppScope[];
  readonly execution?: ChatCommandExecution;
  readonly compile: TwitchCommandDefinition["compile"];
}

interface KickCommandOptions {
  readonly name: string;
  readonly usage: string;
  readonly description: () => string;
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
    get description() {
      return options.description();
    },
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
    get description() {
      return options.description();
    },
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

const translate = i18n.t as (key: string, values?: Record<string, string | number>) => string;

function commandError(key: string, values?: Record<string, string | number>): Error {
  return new Error(translate(`chatCommand.${key}`, values));
}

function requiredUsername(args: string, command: string): { login: string; rest: string } {
  const [rawLogin, ...rest] = argumentsList(args);
  const login = rawLogin?.replace(/^@+/, "");
  if (!login) throw commandError("needsUsername", { command });
  if (!/^[a-zA-Z0-9_]{1,25}$/.test(login)) {
    throw commandError("needsValidUsername", { command });
  }
  return { login, rest: rest.join(" ") };
}

function requiredMessage(args: string, command: string, maximum = 500): string {
  const message = args.trim();
  if (!message) throw commandError("needsMessage", { command });
  if (message.length > maximum) {
    throw commandError("messageTooLong", { command, maximum });
  }
  return message;
}

function noArguments(args: string, command: string): void {
  if (args.trim()) throw commandError("doesNotAcceptArguments", { command });
}

function boundedReason(reason: string, command: string, maximum = 500): string | undefined {
  if (!reason) return undefined;
  if (reason.length > maximum) {
    throw commandError("reasonTooLong", { command, maximum });
  }
  return reason;
}

function kickToggle(args: string, command: string): { enabled: boolean; rest: string[] } {
  const [rawMode, ...rest] = argumentsList(args);
  const mode = rawMode?.toLowerCase();
  if (mode !== "on" && mode !== "off") {
    throw commandError("needsOnOrOff", { command });
  }
  return { enabled: mode === "on", rest };
}

function kickPositiveSeconds(rawValue: string | undefined, command: string): number {
  const seconds = Number(rawValue);
  if (!rawValue || !/^\d+$/.test(rawValue) || !Number.isSafeInteger(seconds) || seconds < 1) {
    throw commandError("needsPositiveSeconds", { command });
  }
  return seconds;
}

function kickTimeoutMinutes(rawValue: string | undefined): number {
  const seconds = kickPositiveSeconds(rawValue, "timeout");
  if (seconds % 60 !== 0 || seconds > 604_800) {
    throw commandError("timeoutSecondsRange");
  }
  return seconds / 60;
}

function kickChannelHandoff(key: string, values?: Record<string, string>): KickCommandEffect {
  return { kind: "local-notice", message: translate(`chatCommand.${key}`, values) };
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
  if (!namedColor) throw commandError("unsupportedColor");
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

function localTwitchNotice(key: string): TwitchCommandDefinition["compile"] {
  return () => ({ kind: "local-notice", message: translate(`chatCommand.${key}`) });
}

function followersMinutes(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(\d+)(m|h|d|w|mo)?$/i.exec(value);
  if (!match) {
    throw commandError("followersDurationUnits");
  }
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? "m";
  const multiplier = { m: 1, h: 60, d: 1_440, w: 10_080, mo: 43_200 }[unit] ?? 1;
  const minutes = amount * multiplier;
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 129_600) {
    throw commandError("followersDurationRange");
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
    throw commandError("durationRange", {
      command: options.command,
      minimum: options.minimum,
      maximum: options.maximum,
    });
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
      throw commandError("commercialLength");
  }
}

const TWITCH_COMMAND_CATALOG = [
  twitchCommand({
    name: "mods",
    usage: "/mods",
    description: () => i18n.t("chat.showThisChannelSModeratorsOnTwitch"),
    compile: (args) => {
      noArguments(args, "mods");
      return { kind: "channel-members", list: "moderators" };
    },
  }),
  twitchCommand({
    name: "vips",
    usage: "/vips",
    description: () => i18n.t("chat.showThisChannelSVIPsOnTwitch"),
    compile: (args) => {
      noArguments(args, "vips");
      return { kind: "channel-members", list: "vips" };
    },
  }),
  twitchCommand({
    name: "color",
    usage: "/color [color]",
    description: () => i18n.t("chat.changeYourTwitchUsernameColor"),
    scopes: ["user:manage:chat_color"],
    compile: (args) => ({
      kind: "api",
      action: { kind: "update-chat-color", color: twitchChatColor(args) },
    }),
  }),
  twitchCommand({
    name: "w",
    usage: "/w [username] [message]",
    description: () => i18n.t("chat.whisperAnotherTwitchUser"),
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
    description: () => i18n.t("chat.blockATwitchUser"),
    scopes: ["user:manage:blocked_users"],
    compile: apiTargetCommand("block"),
  }),
  twitchCommand({
    name: "unblock",
    usage: "/unblock [username]",
    description: () => i18n.t("chat.unblockATwitchUser"),
    scopes: ["user:manage:blocked_users"],
    compile: apiTargetCommand("unblock"),
  }),
  twitchCommand({
    name: "disconnect",
    usage: "/disconnect",
    description: () => i18n.t("chat.leaveThisChannelSChat"),
    compile: (args) => {
      noArguments(args, "disconnect");
      return { kind: "disconnect" };
    },
  }),
  twitchCommand({
    name: "gift",
    usage: "/gift [quantity]",
    description: () => i18n.t("chat.showGiftSubscriptionAvailability"),
    compile: (args) => {
      const [quantity, extra] = argumentsList(args);
      if (
        extra ||
        (quantity && (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 100))
      ) {
        throw commandError("giftQuantity");
      }
      return {
        kind: "local-notice",
        message: i18n.t("chat.twitchHandlesGiftPurchasesInItsSecureSubscriptionFlow"),
      };
    },
  }),
  twitchCommand({
    name: "vote",
    usage: "/vote",
    description: () => i18n.t("chat.showPollVotingAvailability"),
    compile: (args) => {
      noArguments(args, "vote");
      return {
        kind: "local-notice",
        message: i18n.t("chat.twitchDoesNotProvideThirdPartyAppsAnAPIForCastingPollVotes"),
      };
    },
  }),
  twitchCommand({
    name: "timeout",
    usage: "/timeout [username] [seconds] [reason]",
    description: () => i18n.t("chat.temporarilyTimeoutAUser"),
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
    description: () => i18n.t("chat.permanentlyBanAUser"),
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
    description: () => i18n.t("chat.removeAChannelBanOrTimeout"),
    roles: moderatorRoles,
    scopes: ["moderator:manage:banned_users"],
    compile: apiTargetCommand("unban"),
  }),
  twitchCommand({
    name: "clear",
    usage: "/clear",
    description: () => i18n.t("chat.clearTheChannelSChatHistory"),
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
    description: () => i18n.t("chat.enableFollowersOnlyMode"),
    roles: moderatorRoles,
    scopes: ["moderator:manage:chat_settings"],
    compile: (args) => {
      const [duration, extra] = argumentsList(args);
      if (extra) throw commandError("acceptsOneDuration", { command: "followers" });
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
    description: () => i18n.t("chat.disableFollowersOnlyMode"),
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
    description: () => i18n.t("chat.enableSlowMode"),
    roles: moderatorRoles,
    scopes: ["moderator:manage:chat_settings"],
    compile: (args) => {
      const [duration, extra] = argumentsList(args);
      if (extra) throw commandError("acceptsOneDuration", { command: "slow" });
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
    description: () => i18n.t("chat.disableSlowMode"),
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
      ["subscribers", "subscriber_mode", true, "enableSubscribersOnly"],
      ["subscribersoff", "subscriber_mode", false, "disableSubscribersOnly"],
      ["emoteonly", "emote_mode", true, "enableEmoteOnly"],
      ["emoteonlyoff", "emote_mode", false, "disableEmoteOnly"],
      ["uniquechat", "unique_chat_mode", true, "requireUniqueChat"],
      ["uniquechatoff", "unique_chat_mode", false, "disableUniqueChat"],
    ] as const
  ).map(([name, setting, enabled, descriptionKey]) =>
    twitchCommand({
      name,
      usage: `/${name}`,
      description: () => translate(`chatCommand.${descriptionKey}`),
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
    description: () => i18n.t("chat.sendAndPinAChatMessage"),
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
    description: () => i18n.t("chat.sendAHighlightedAnnouncement"),
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
    description: () => i18n.t("chat.shoutOutAnotherChannel"),
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
      description: () => i18n.t("chat.setAUserSValue0Status", { value0: name }),
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
      description: () => i18n.t("chat.removeAUserSSuspiciousUserTreatment"),
      roles: moderatorRoles,
      compile: (args) => {
        requiredUsername(args, name);
        return {
          kind: "local-notice",
          message: i18n.t(
            "chat.twitchSPublicRemovalEndpointClearsEitherSuspiciousUserTreatmentSoStreamFusionDoesNotRunThisCommandFromChat"
          ),
        };
      },
    })
  ),
  twitchCommand({
    name: "user",
    usage: "/user [username]",
    description: () => i18n.t("chat.showTwitchUserCardAvailability"),
    roles: moderatorRoles,
    compile: (args) => {
      requiredUsername(args, "user");
      return {
        kind: "local-notice",
        message: i18n.t("chat.twitchKeepsTheCompleteViewerCardAndModerationHistoryInItsOwnUI"),
      };
    },
  }),
  twitchCommand({
    name: "requests",
    usage: "/requests",
    description: () => i18n.t("chat.showChannelPointsRequestAvailability"),
    roles: moderatorRoles,
    compile: localTwitchNotice("channelPointsInTwitch"),
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
      description: () => i18n.t("chat.openValue0ManagementInStreamFusion", { value0: section }),
      roles: moderatorRoles,
      compile: (_args, role) =>
        role === "broadcaster"
          ? { kind: "engagement", section }
          : {
              kind: "local-notice",
              message: i18n.t(
                "chat.twitchSPublicValue0MutationsRequireTheBroadcasterSTokenSoStreamFusionDoesNotRunThisModeratorCommandFromChat",
                { value0: section }
              ),
            },
    })
  ),
  ...(
    [
      ["mod", "add-moderator", "addModerator"],
      ["unmod", "remove-moderator", "removeModerator"],
      ["vip", "add-vip", "addVip"],
      ["unvip", "remove-vip", "removeVip"],
    ] as const
  ).map(([name, kind, descriptionKey]) =>
    twitchCommand({
      name,
      usage: `/${name} [username]`,
      description: () => translate(`chatCommand.${descriptionKey}`),
      roles: broadcasterRoles,
      scopes: [kind.includes("moderator") ? "channel:manage:moderators" : "channel:manage:vips"],
      compile: apiTargetCommand(kind, name),
    })
  ),
  twitchCommand({
    name: "rules",
    usage: "/rules",
    description: () => i18n.t("chat.showThisChannelSChatRules"),
    roles: broadcasterRoles,
    compile: localTwitchNotice("rulesUnavailable"),
  }),
  twitchCommand({
    name: "sharedchat",
    usage: "/sharedchat",
    description: () => i18n.t("chat.showSharedChatManagementAvailability"),
    roles: broadcasterRoles,
    compile: localTwitchNotice("sharedChatInStreamManager"),
  }),
  twitchCommand({
    name: "commercial",
    usage: "/commercial [30|60|90|120|150|180]",
    description: () => i18n.t("chat.runACommercialBreak"),
    roles: broadcasterRoles,
    scopes: ["channel:edit:commercial"],
    compile: (args) => {
      const [rawLength, extra] = argumentsList(args);
      if (extra) {
        throw commandError("commercialLength");
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
    description: () => i18n.t("chat.showCreatorGoalManagementAvailability"),
    roles: broadcasterRoles,
    compile: localTwitchNotice("creatorGoalsUnavailable"),
  }),
  twitchCommand({
    name: "raid",
    usage: "/raid [channel]",
    description: () => i18n.t("chat.startARaid"),
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
    description: () => i18n.t("chat.cancelAPendingRaid"),
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
    description: () => i18n.t("chat.createAStreamMarker"),
    roles: broadcasterRoles,
    scopes: ["channel:manage:broadcast"],
    compile: (args) => {
      const description = args.trim();
      if (description.length > 140) {
        throw commandError("markerDescriptionTooLong");
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
    description: () => i18n.t("chat.showTheCommandsAvailableToYou"),
    execution: "local",
    compile: () => ({ kind: "help" }),
  }),
  twitchCommand({
    name: "me",
    usage: "/me [message]",
    description: () => i18n.t("chat.sendAnActionMessage"),
    scopes: ["chat:edit"],
    execution: "action-message",
    compile: (args) => ({ kind: "irc-action", message: requiredMessage(args, "me") }),
  }),
] as const;

const KICK_LOCAL_COMMANDS = [
  kickCommand({
    name: "help",
    usage: "/help [command]",
    description: () => i18n.t("chat.showTheCommandsAvailableToYou"),
    execution: "local",
    compile: () => ({ kind: "help" }),
  }),
  kickCommand({
    name: "me",
    usage: "/me [message]",
    description: () => i18n.t("chat.sendAnActionMessage"),
    execution: "action-message",
    compile: (args) => ({ kind: "action-message", message: requiredMessage(args, "me") }),
  }),
] as const;

const KICK_COMMAND_CATALOG = [
  kickCommand({
    name: "ban",
    usage: "/ban [username] [reason]",
    description: () => i18n.t("chat.permanentlyBanAUser"),
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
    description: () => i18n.t("chat.removeAChannelBanOrTimeout"),
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
    description: () => i18n.t("chat.temporarilyPreventAUserFromChatting"),
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
    description: () => i18n.t("chat.clearAllCurrentChatMessages"),
    roles: moderatorRoles,
    compile: (args) => {
      noArguments(args, "clear");
      return kickChannelHandoff("kickClearUnavailable");
    },
  }),
  ...(
    [
      ["mod", "giveModeratorRole"],
      ["unmod", "removeModeratorRole"],
    ] as const
  ).map(([name, descriptionKey]) =>
    kickCommand({
      name,
      usage: `/${name} [username]`,
      description: () => translate(`chatCommand.${descriptionKey}`),
      roles: broadcasterRoles,
      compile: (args) => {
        const target = requiredUsername(args, name);
        noArguments(target.rest, name);
        return kickChannelHandoff("kickModeratorMutationUnavailable");
      },
    })
  ),
  kickCommand({
    name: "user",
    usage: "/user [username]",
    description: () => i18n.t("chat.showKickUserInformationAvailability"),
    roles: moderatorRoles,
    compile: (args) => {
      const target = requiredUsername(args, "user");
      noArguments(target.rest, "user");
      return kickChannelHandoff("kickUserCardInChat");
    },
  }),
  kickCommand({
    name: "slow",
    usage: "/slow [on|off] [seconds]",
    description: () => i18n.t("chat.enableOrDisableSlowMode"),
    roles: moderatorRoles,
    compile: (args) => {
      const toggle = kickToggle(args, "slow");
      if (!toggle.enabled) {
        if (toggle.rest.length > 0) {
          throw commandError("doesNotAcceptArguments", { command: "slow off" });
        }
        return kickChannelHandoff("kickSlowModeInChat");
      }
      if (toggle.rest.length !== 1) {
        throw commandError("needsPositiveSeconds", { command: "slow on" });
      }
      kickPositiveSeconds(toggle.rest[0], "slow on");
      return kickChannelHandoff("kickSlowModeInChat");
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
      description: () => i18n.t("chat.enableOrDisableValue0Mode", { value0: mode }),
      roles: moderatorRoles,
      compile: (args) => {
        const toggle = kickToggle(args, name);
        if (toggle.rest.length > 0) throw commandError("acceptsOnlyOnOrOff", { command: name });
        return kickChannelHandoff("kickModeInChat", { mode });
      },
    })
  ),
  kickCommand({
    name: "subonly",
    usage: "/subonly [on|off]",
    description: () => i18n.t("chat.enableOrDisableSubscribersOnlyMode"),
    roles: broadcasterRoles,
    compile: (args) => {
      const toggle = kickToggle(args, "subonly");
      if (toggle.rest.length > 0) {
        throw commandError("acceptsOnlyOnOrOff", { command: "subonly" });
      }
      return kickChannelHandoff("kickSubscribersOnlyInChat");
    },
  }),
  kickCommand({
    name: "title",
    usage: "/title [new title]",
    description: () => i18n.t("chat.setTheCurrentStreamTitle"),
    roles: moderatorRoles,
    compile: (args) => {
      requiredMessage(args, "title");
      return kickChannelHandoff("kickTitleOwnerOnly");
    },
  }),
  kickCommand({
    name: "category",
    usage: "/category",
    description: () => i18n.t("chat.showStreamCategoryControlsAvailability"),
    roles: moderatorRoles,
    compile: (args) => {
      noArguments(args, "category");
      return kickChannelHandoff("kickCategorySelector");
    },
  }),
  kickCommand({
    name: "raid",
    usage: "/raid",
    description: () => i18n.t("chat.showKickRaidControlsAvailability"),
    roles: broadcasterRoles,
    compile: (args) => {
      noArguments(args, "raid");
      return kickChannelHandoff("kickRaidUnavailable");
    },
  }),
  ...(
    [
      ["og", "giveOgBadge"],
      ["unog", "removeOgBadge"],
      ["vip", "giveVipBadge"],
      ["unvip", "removeVipBadge"],
    ] as const
  ).map(([name, descriptionKey]) =>
    kickCommand({
      name,
      usage: `/${name} [username]`,
      description: () => translate(`chatCommand.${descriptionKey}`),
      roles: broadcasterRoles,
      compile: (args) => {
        const target = requiredUsername(args, name);
        noArguments(target.rest, name);
        return kickChannelHandoff("kickBadgeMutationUnavailable");
      },
    })
  ),
  ...(
    [
      ["poll", "openPollCreation"],
      ["polldelete", "deleteActivePoll"],
      ["prediction", "openPredictionManagement"],
    ] as const
  ).map(([name, descriptionKey]) =>
    kickCommand({
      name,
      usage: `/${name}`,
      description: () => translate(`chatCommand.${descriptionKey}`),
      roles: moderatorRoles,
      compile: (args) => {
        noArguments(args, name);
        return kickChannelHandoff("kickEngagementInChat");
      },
    })
  ),
  ...(
    [
      ["multi", "togglePartnerMultistreaming"],
      ["kpp", "togglePartnerIncome"],
    ] as const
  ).map(([name, descriptionKey]) =>
    kickCommand({
      name,
      usage: `/${name} [on|off]`,
      description: () =>
        i18n.t("chat.value0PartnerChannelsOnly", {
          value0: translate(`chatCommand.${descriptionKey}`),
        }),
      roles: broadcasterRoles,
      requiresPartnerChannel: true,
      compile: (args) => {
        const toggle = kickToggle(args, name);
        if (toggle.rest.length > 0) throw commandError("acceptsOnlyOnOrOff", { command: name });
        return kickChannelHandoff("kickPartnerControlsInUi");
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
    throw commandError("notPlatformCommand", {
      command: command.definition.name,
      platform: "Twitch",
    });
  }
  return command.definition.compile(command.args, role);
}

export function compileKickCommand(
  command: ParsedChatCommand,
  role: ChatCommandRole
): KickCommandEffect {
  if (command.definition.platform !== "kick") {
    throw commandError("notPlatformCommand", {
      command: command.definition.name,
      platform: "Kick",
    });
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
    return error instanceof Error ? error.message : i18n.t("chatCommand.invalidArguments");
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
