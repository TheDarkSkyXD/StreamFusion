/** Desktop-compatible chat display preference group (`chatDisplay`). */

export type TimestampFormat =
  | "H:mm"
  | "HH:mm"
  | "H:mm:ss"
  | "HH:mm:ss"
  | "h:mm a"
  | "hh:mm a"
  | "h:mm:ss a"
  | "hh:mm:ss a";

export type ChatDensity = "cozy" | "compact" | "loose";
export type ChatPauseMode = "scroll" | "mouseover" | "alt" | "mouseover-alt";
export type DeletedMessageDisplayMode =
  | "tombstone"
  | "message"
  | "compact"
  | "audit";
export type ModerationHighlightStyle = "compact" | "cozy";

export type ChatDisplayPreferences = {
  readonly boldUsernames: boolean;
  readonly readableColorForUncolored: boolean;
  readonly themeAdaptUsernameColor: boolean;
  readonly timestamps: boolean;
  readonly timestampFormat: TimestampFormat;
  readonly fontSizePx: number;
  readonly emoteSizePx: number;
  readonly density: ChatDensity;
  readonly hoverSmooth: boolean;
  readonly pauseMode: ChatPauseMode;
  readonly chatWidthPct: number;
  readonly chatWidthPx: 280 | 340 | 420;
  readonly quickEmotes: boolean;
  readonly enable7tv: boolean;
  readonly enableBttv: boolean;
  readonly enableFfz: boolean;
  readonly enable7tvBadges: boolean;
  readonly enable7tvUsernamePaints: boolean;
  readonly enableBttvBadges: boolean;
  readonly enableFfzBadges: boolean;
  readonly animatedEmotes: boolean;
  readonly overlayEmotes: boolean;
  readonly systemMessageEmotes: boolean;
  readonly showUserNotices: boolean;
  readonly showClearMsg: boolean;
  readonly deletedMessageDisplay: DeletedMessageDisplayMode;
  readonly moderationHighlightStyle: ModerationHighlightStyle;
  readonly showClearChat: boolean;
  readonly firstMsgHighlight: boolean;
  readonly showPolls: boolean;
  readonly showPredictions: boolean;
  readonly showTwitchPinDurationDialog: boolean;
  readonly recentMessagesOnJoin: boolean;
  readonly recentMessagesLimit: number;
  readonly messageLimit: number;
};

export type ChatDisplayPreferencePatch = Partial<ChatDisplayPreferences>;

export type ChatDisplaySettingsView = {
  readonly preferences: ChatDisplayPreferences;
  readonly disclosure: string;
};

export type ChatDisplaySettingsSession = {
  apply(patch: ChatDisplayPreferencePatch): Promise<ChatDisplaySettingsView>;
  load(): Promise<ChatDisplaySettingsView>;
  peek(): ChatDisplaySettingsView;
  snapshot(): Promise<ChatDisplayPreferences>;
  subscribe(listener: () => void): () => void;
};

export const CHAT_DISPLAY_SETTING_KEY = "chatDisplay.v1";

export function serializeChatDisplayPreferences(
  value: ChatDisplayPreferences,
): string {
  return JSON.stringify({ ...value, version: 1 });
}
