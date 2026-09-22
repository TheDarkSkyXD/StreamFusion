export type SettingsPanelId =
  | "appearance"
  | "playback"
  | "player-controls"
  | "buffer"
  | "multiview"
  | "notifications"
  | "chat"
  | "predictions"
  | "adblock"
  | "proxy"
  | "integrations"
  | "api-tokens"
  | "updates"
  | "diagnostics"
  | "logs"
  | "report-bug"
  | "about";

export type SettingsControlCatalogEntry = {
  readonly id: string;
  readonly keywords: readonly string[];
  readonly label: string;
  readonly panel: SettingsPanelId;
};

function entry(
  id: string,
  panel: SettingsPanelId,
  label: string,
  keywords: readonly string[],
): SettingsControlCatalogEntry {
  return { id, keywords, label, panel };
}

export const SETTINGS_CONTROL_CATALOG: readonly SettingsControlCatalogEntry[] =
  [
    entry("theme", "appearance", "Theme", ["theme", "dark", "appearance"]),
    entry("density", "appearance", "Density", [
      "density",
      "compact",
      "comfortable",
      "spacious",
      "spacing",
    ]),
    entry("language", "appearance", "Language", [
      "language",
      "english",
      "locale",
    ]),
    entry("restore-session", "appearance", "Restore session", [
      "restore",
      "session",
      "route",
      "startup",
    ]),
    entry("resume-playback", "appearance", "Resume playback", [
      "resume",
      "playback",
      "autoplay",
      "watch",
    ]),
    entry("quality", "playback", "Default quality", [
      "quality",
      "resolution",
      "auto",
      "1080p",
    ]),
    entry("carousel", "playback", "Home carousel interval", [
      "carousel",
      "home",
      "featured",
      "interval",
    ]),
    entry("captions", "playback", "Local captions", [
      "captions",
      "subtitles",
      "local",
    ]),
    entry("token-player", "playback", "Token player", [
      "token",
      "player",
      "exoplayer",
      "native",
    ]),
    entry("hevc", "playback", "Allow HEVC", ["hevc", "h265", "codec"]),
    entry("stream-device-id", "playback", "Stream device id", [
      "device",
      "id",
      "stream",
    ]),
    entry("control-0", "player-controls", "Quality control", [
      "quality",
      "control",
      "chrome",
    ]),
    entry("control-1", "player-controls", "Speed control", [
      "speed",
      "control",
      "chrome",
    ]),
    entry("control-2", "player-controls", "Volume control", [
      "volume",
      "mute",
      "control",
    ]),
    entry("control-3", "player-controls", "Fullscreen control", [
      "fullscreen",
      "control",
    ]),
    entry("control-4", "player-controls", "Theater control", [
      "theater",
      "control",
    ]),
    entry("control-5", "player-controls", "Video stats control", [
      "stats",
      "video",
      "control",
    ]),
    entry("rewind", "player-controls", "Rewind interval", [
      "rewind",
      "seek",
      "back",
    ]),
    entry("fast-forward", "player-controls", "Fast-forward interval", [
      "fast",
      "forward",
      "seek",
    ]),
    entry("low-latency", "buffer", "Low latency", [
      "low",
      "latency",
      "live",
      "buffer",
    ]),
    entry("target-latency", "buffer", "Target live offset", [
      "target",
      "latency",
      "live",
      "offset",
    ]),
    entry("forward-buffer", "buffer", "Forward buffer", ["forward", "buffer"]),
    entry("max-buffer", "buffer", "Max buffer", ["max", "buffer"]),
    entry("multiview-cap", "multiview", "Multiview slot cap", [
      "multiview",
      "multistream",
      "slots",
      "cap",
    ]),
    entry("background-quality", "multiview", "Background quality", [
      "background",
      "quality",
      "multistream",
    ]),
    entry("android-notifications", "notifications", "Android notifications", [
      "android",
      "notifications",
      "permission",
      "alerts",
    ]),
    entry("live-activity", "notifications", "Live Notification history", [
      "activity",
      "live",
      "history",
      "inbox",
    ]),
    entry("toast", "notifications", "In-app banners", [
      "toast",
      "banner",
      "foreground",
    ]),
    entry("sound", "notifications", "Sound", ["sound", "channel", "alert"]),
    entry("notify-twitch", "notifications", "Twitch", [
      "twitch",
      "notify",
      "live",
    ]),
    entry("notify-kick", "notifications", "Kick", ["kick", "notify", "live"]),
    entry("notify-guest", "notifications", "Guest Follow notifications", [
      "guest",
      "follow",
      "alerts",
    ]),
    entry("favorites-only", "notifications", "Favorites only", [
      "favorites",
      "channels",
      "filter",
    ]),
    entry("restart-grace", "notifications", "Restart grace", [
      "restart",
      "grace",
      "cooldown",
    ]),
    entry("chat-density", "chat", "Chat density", [
      "chat",
      "density",
      "compact",
      "cozy",
      "loose",
    ]),
    entry("chat-timestamps", "chat", "Show timestamps", [
      "chat",
      "timestamps",
      "time",
    ]),
    entry("chat-timestamp-format", "chat", "Timestamp format", [
      "chat",
      "timestamp",
      "format",
    ]),
    entry("chat-font-size", "chat", "Font size", ["chat", "font", "size"]),
    entry("chat-emote-size", "chat", "Emote size", ["chat", "emote", "size"]),
    entry("chat-readable-color", "chat", "Readable username colors", [
      "chat",
      "color",
      "username",
      "readable",
    ]),
    entry("chat-theme-adapt", "chat", "Adapt username colors", [
      "chat",
      "theme",
      "username",
      "color",
    ]),
    entry("chat-emotes-7tv", "chat", "7TV emotes", ["chat", "7tv", "emotes"]),
    entry("chat-emotes-bttv", "chat", "BTTV emotes", [
      "chat",
      "bttv",
      "emotes",
    ]),
    entry("chat-emotes-ffz", "chat", "FFZ emotes", ["chat", "ffz", "emotes"]),
    entry("chat-animated-emotes", "chat", "Animated emotes", [
      "chat",
      "animated",
      "emotes",
    ]),
    entry("chat-overlay-emotes", "chat", "Overlay emotes", [
      "chat",
      "overlay",
      "emotes",
    ]),
    entry("chat-system-emotes", "chat", "Emotes in system messages", [
      "chat",
      "system",
      "emotes",
    ]),
    entry("chat-badges", "chat", "Third-party badges", [
      "chat",
      "badges",
      "7tv",
      "bttv",
      "ffz",
    ]),
    entry("chat-paints", "chat", "7TV username paints", [
      "chat",
      "paints",
      "7tv",
    ]),
    entry("chat-message-limit", "chat", "Message limit", [
      "chat",
      "message",
      "limit",
      "buffer",
    ]),
    entry("chat-recent-on-join", "chat", "Load recent messages on join", [
      "chat",
      "recent",
      "join",
    ]),
    entry("chat-user-notices", "chat", "Show sub and raid notices", [
      "chat",
      "notices",
      "subs",
      "raids",
      "events",
    ]),
    entry("chat-deleted", "chat", "Deleted message display", [
      "chat",
      "deleted",
      "moderation",
    ]),
    entry("chat-clear", "chat", "Show chat cleared notices", [
      "chat",
      "clear",
      "moderation",
    ]),
    entry("chat-first-msg", "chat", "Highlight first-time chatters", [
      "chat",
      "first",
      "highlight",
    ]),
    entry("chat-polls", "chat", "Show polls", ["chat", "polls", "events"]),
    entry("chat-predictions-events", "chat", "Show predictions in chat", [
      "chat",
      "predictions",
      "events",
    ]),
    entry("prediction-style", "predictions", "Prediction style", [
      "predictions",
      "style",
      "native",
      "unified",
      "widget",
    ]),
    entry("adblock", "adblock", "Enable ad blocking", [
      "adblock",
      "filter",
      "ads",
    ]),
    entry("adblock-method", "adblock", "Method", ["method", "strip", "canary"]),
    entry("twitch-playlist-sources", "adblock", "Twitch playlist sources", [
      "playlist",
      "luminous",
      "fallback",
      "$channel",
      "usher",
    ]),
    entry("ordered-playlist-sources", "adblock", "Ordered playlist sources", [
      "playlist",
      "sources",
      "order",
      "fallback",
      "luminous",
    ]),
    entry("proxy-enabled", "proxy", "Enable proxy", [
      "proxy",
      "network",
      "enabled",
    ]),
    entry("proxy-host", "proxy", "Host", ["proxy", "host", "hostname"]),
    entry("proxy-port", "proxy", "Port", ["proxy", "port"]),
    entry("proxy-username", "proxy", "Username", [
      "proxy",
      "username",
      "credential",
    ]),
    entry("proxy-password", "proxy", "Password", [
      "proxy",
      "password",
      "secret",
    ]),
    entry("integrations-accounts", "integrations", "Connected accounts", [
      "integrations",
      "accounts",
      "twitch",
      "kick",
      "signin",
      "connect",
    ]),
    entry("api-token-status", "api-tokens", "Token status", [
      "api",
      "tokens",
      "token",
      "scopes",
      "expiry",
      "validate",
    ]),
    entry("update-status", "updates", "Current version", [
      "updates",
      "version",
      "release",
      "github",
    ]),
    entry("check-for-updates", "updates", "Check now", [
      "check",
      "updates",
      "github",
      "apk",
    ]),
    entry(
      "automatic-foreground-update-checks",
      "updates",
      "Check automatically while foregrounded",
      ["automatic", "foreground", "updates"],
    ),
    entry("diagnostic-window", "diagnostics", "Observation window", [
      "diagnostics",
      "window",
      "resources",
    ]),
    entry("diagnostic-io-window", "diagnostics", "I/O observation window", [
      "diagnostics",
      "io",
      "window",
    ]),
    entry("diagnostic-detail", "diagnostics", "Detailed collection", [
      "diagnostics",
      "detail",
      "collection",
    ]),
    entry("log-level", "logs", "Minimum level", ["logs", "level", "minimum"]),
    entry("log-source", "logs", "Source", ["logs", "source", "filter"]),
    entry("open-runtime-logs", "logs", "Open", ["logs", "open", "runtime"]),
    entry("report-description", "report-bug", "What happened?", [
      "bug",
      "report",
      "description",
    ]),
    entry("attach-logs", "report-bug", "Attach redacted logs", [
      "bug",
      "logs",
      "redacted",
    ]),
    entry("attach-profile", "report-bug", "Attach Capability Profile", [
      "bug",
      "profile",
      "capability",
    ]),
    entry("build-report", "report-bug", "Build report", [
      "bug",
      "build",
      "report",
    ]),
    entry("share-diagnostic-report", "report-bug", "Share", [
      "share",
      "report",
      "bug",
    ]),
    entry("open-source-licenses", "about", "Open-source licenses", [
      "licenses",
      "open",
      "source",
    ]),
    entry("privacy", "about", "Privacy", ["privacy", "notice"]),
    entry("clear-history", "about", "Clear history", ["history", "clear"]),
    entry("remove-media", "about", "Remove media", ["media", "remove", "jobs"]),
    entry("disconnect-accounts", "about", "Disconnect accounts", [
      "disconnect",
      "accounts",
    ]),
    entry("reset-app", "about", "Reset the app", ["reset", "app", "wipe"]),
  ];

export function searchSettingsControls(
  query: string,
  catalog: readonly SettingsControlCatalogEntry[] = SETTINGS_CONTROL_CATALOG,
): readonly SettingsControlCatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return catalog;
  return catalog.filter((item) => catalogHaystack(item).includes(needle));
}

export function settingsPanelsFor(
  matches: readonly SettingsControlCatalogEntry[],
): readonly SettingsPanelId[] {
  const seen = new Set<SettingsPanelId>();
  const panels: SettingsPanelId[] = [];
  for (const match of matches) {
    if (seen.has(match.panel)) continue;
    seen.add(match.panel);
    panels.push(match.panel);
  }
  return panels;
}

function catalogHaystack(item: SettingsControlCatalogEntry): string {
  return [item.id, item.label, item.panel, ...item.keywords]
    .join(" ")
    .toLowerCase();
}
