import type {
  ChatDensity,
  ChatDisplayPreferencePatch,
  ChatDisplayPreferences,
  ChatDisplaySettingsView,
  ChatPauseMode,
  DeletedMessageDisplayMode,
  ModerationHighlightStyle,
  TimestampFormat,
} from "../capabilities/chat-display-settings";

export const DEFAULT_CHAT_DISPLAY_PREFERENCES: ChatDisplayPreferences = {
  boldUsernames: false,
  readableColorForUncolored: true,
  themeAdaptUsernameColor: true,
  timestamps: false,
  timestampFormat: "HH:mm",
  fontSizePx: 16,
  emoteSizePx: 28,
  density: "cozy",
  hoverSmooth: true,
  pauseMode: "scroll",
  chatWidthPct: 30,
  chatWidthPx: 340,
  quickEmotes: true,
  enable7tv: true,
  enableBttv: true,
  enableFfz: true,
  enable7tvBadges: true,
  enable7tvUsernamePaints: true,
  enableBttvBadges: true,
  enableFfzBadges: true,
  animatedEmotes: true,
  overlayEmotes: true,
  systemMessageEmotes: true,
  showUserNotices: true,
  showClearMsg: true,
  deletedMessageDisplay: "compact",
  moderationHighlightStyle: "compact",
  showClearChat: true,
  firstMsgHighlight: true,
  showPolls: true,
  showPredictions: true,
  showTwitchPinDurationDialog: true,
  recentMessagesOnJoin: true,
  recentMessagesLimit: 200,
  messageLimit: 600,
};

const TIMESTAMP_FORMATS: readonly TimestampFormat[] = [
  "H:mm",
  "HH:mm",
  "H:mm:ss",
  "HH:mm:ss",
  "h:mm a",
  "hh:mm a",
  "h:mm:ss a",
  "hh:mm:ss a",
];

const DENSITIES: readonly ChatDensity[] = ["cozy", "compact", "loose"];
const PAUSE_MODES: readonly ChatPauseMode[] = [
  "scroll",
  "mouseover",
  "alt",
  "mouseover-alt",
];
const DELETED_MODES: readonly DeletedMessageDisplayMode[] = [
  "tombstone",
  "message",
  "compact",
  "audit",
];
const HIGHLIGHT_STYLES: readonly ModerationHighlightStyle[] = [
  "compact",
  "cozy",
];
const CHAT_WIDTHS = [280, 340, 420] as const;

export const CHAT_FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20] as const;
export const CHAT_EMOTE_SIZE_OPTIONS = [16, 24, 28, 36, 48] as const;
export const CHAT_MESSAGE_LIMIT_OPTIONS = [
  100, 200, 400, 600, 800, 1000,
] as const;
export const CHAT_RECENT_LIMIT_OPTIONS = [100, 200, 400, 600, 800] as const;

export function parseChatDisplayPreferences(
  raw: string | null,
): ChatDisplayPreferences {
  if (raw == null || raw.length === 0) {
    return DEFAULT_CHAT_DISPLAY_PREFERENCES;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ChatDisplayPreferences>;
    return mergeChatDisplayPreferences(DEFAULT_CHAT_DISPLAY_PREFERENCES, parsed);
  } catch {
    return DEFAULT_CHAT_DISPLAY_PREFERENCES;
  }
}

export { serializeChatDisplayPreferences } from "../capabilities/chat-display-settings";

export function mergeChatDisplayPreferences(
  base: ChatDisplayPreferences,
  patch: ChatDisplayPreferencePatch,
): ChatDisplayPreferences {
  return {
    boldUsernames: bool(patch.boldUsernames, base.boldUsernames),
    readableColorForUncolored: bool(
      patch.readableColorForUncolored,
      base.readableColorForUncolored,
    ),
    themeAdaptUsernameColor: bool(
      patch.themeAdaptUsernameColor,
      base.themeAdaptUsernameColor,
    ),
    timestamps: bool(patch.timestamps, base.timestamps),
    timestampFormat: oneOf(
      patch.timestampFormat,
      TIMESTAMP_FORMATS,
      base.timestampFormat,
    ),
    fontSizePx: clampInt(patch.fontSizePx, 10, 20, base.fontSizePx),
    emoteSizePx: clampInt(patch.emoteSizePx, 16, 56, base.emoteSizePx),
    density: oneOf(patch.density, DENSITIES, base.density),
    hoverSmooth: bool(patch.hoverSmooth, base.hoverSmooth),
    pauseMode: oneOf(patch.pauseMode, PAUSE_MODES, base.pauseMode),
    chatWidthPct: clampInt(patch.chatWidthPct, 0, 100, base.chatWidthPct),
    chatWidthPx: oneOf(patch.chatWidthPx, CHAT_WIDTHS, base.chatWidthPx),
    quickEmotes: bool(patch.quickEmotes, base.quickEmotes),
    enable7tv: bool(patch.enable7tv, base.enable7tv),
    enableBttv: bool(patch.enableBttv, base.enableBttv),
    enableFfz: bool(patch.enableFfz, base.enableFfz),
    enable7tvBadges: bool(patch.enable7tvBadges, base.enable7tvBadges),
    enable7tvUsernamePaints: bool(
      patch.enable7tvUsernamePaints,
      base.enable7tvUsernamePaints,
    ),
    enableBttvBadges: bool(patch.enableBttvBadges, base.enableBttvBadges),
    enableFfzBadges: bool(patch.enableFfzBadges, base.enableFfzBadges),
    animatedEmotes: bool(patch.animatedEmotes, base.animatedEmotes),
    overlayEmotes: bool(patch.overlayEmotes, base.overlayEmotes),
    systemMessageEmotes: bool(
      patch.systemMessageEmotes,
      base.systemMessageEmotes,
    ),
    showUserNotices: bool(patch.showUserNotices, base.showUserNotices),
    showClearMsg: bool(patch.showClearMsg, base.showClearMsg),
    deletedMessageDisplay: oneOf(
      patch.deletedMessageDisplay,
      DELETED_MODES,
      base.deletedMessageDisplay,
    ),
    moderationHighlightStyle: oneOf(
      patch.moderationHighlightStyle,
      HIGHLIGHT_STYLES,
      base.moderationHighlightStyle,
    ),
    showClearChat: bool(patch.showClearChat, base.showClearChat),
    firstMsgHighlight: bool(patch.firstMsgHighlight, base.firstMsgHighlight),
    showPolls: bool(patch.showPolls, base.showPolls),
    showPredictions: bool(patch.showPredictions, base.showPredictions),
    showTwitchPinDurationDialog: bool(
      patch.showTwitchPinDurationDialog,
      base.showTwitchPinDurationDialog,
    ),
    recentMessagesOnJoin: bool(
      patch.recentMessagesOnJoin,
      base.recentMessagesOnJoin,
    ),
    recentMessagesLimit: clampInt(
      patch.recentMessagesLimit,
      100,
      800,
      base.recentMessagesLimit,
    ),
    messageLimit: clampInt(patch.messageLimit, 100, 1000, base.messageLimit),
  };
}

export function composeChatDisplaySettingsView(
  preferences: ChatDisplayPreferences,
): ChatDisplaySettingsView {
  return {
    preferences,
    disclosure:
      "Appearance, emote, and event choices apply to Watch chat when that renderer honors them. Desktop-only chrome (panel width, hover pause, pin duration) is saved for sync but not shown here.",
  };
}

export function defaultChatDisplaySettingsView(): ChatDisplaySettingsView {
  return composeChatDisplaySettingsView(DEFAULT_CHAT_DISPLAY_PREFERENCES);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function oneOf<T>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
