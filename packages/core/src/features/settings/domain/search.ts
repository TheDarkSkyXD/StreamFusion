export type SettingsPanelId =
  | "appearance"
  | "playback"
  | "player-controls"
  | "buffer"
  | "multiview";

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

export const SETTINGS_CONTROL_CATALOG: readonly SettingsControlCatalogEntry[] = [
  entry("theme", "appearance", "Theme", ["theme", "dark", "light", "system", "appearance"]),
  entry("density", "appearance", "Density", [
    "density",
    "compact",
    "comfortable",
    "spacious",
    "spacing",
  ]),
  entry("language", "appearance", "Language", ["language", "english", "locale"]),
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
  entry("quality", "playback", "Default quality", ["quality", "resolution", "auto", "1080p"]),
  entry("carousel", "playback", "Home carousel interval", [
    "carousel",
    "home",
    "featured",
    "interval",
  ]),
  entry("captions", "playback", "Local captions", ["captions", "subtitles", "local"]),
  entry("token-player", "playback", "Token player", ["token", "player", "exoplayer", "native"]),
  entry("hevc", "playback", "Allow HEVC", ["hevc", "h265", "codec"]),
  entry("stream-device-id", "playback", "Stream device id", ["device", "id", "stream"]),
  entry("control-0", "player-controls", "Quality control", ["quality", "control", "chrome"]),
  entry("control-1", "player-controls", "Speed control", ["speed", "control", "chrome"]),
  entry("control-2", "player-controls", "Volume control", ["volume", "mute", "control"]),
  entry("control-3", "player-controls", "Fullscreen control", ["fullscreen", "control"]),
  entry("control-4", "player-controls", "Theater control", ["theater", "control"]),
  entry("control-5", "player-controls", "Video stats control", ["stats", "video", "control"]),
  entry("rewind", "player-controls", "Rewind interval", ["rewind", "seek", "back"]),
  entry("fast-forward", "player-controls", "Fast-forward interval", ["fast", "forward", "seek"]),
  entry("low-latency", "buffer", "Low latency", ["low", "latency", "live", "buffer"]),
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
  return [item.id, item.label, item.panel, ...item.keywords].join(" ").toLowerCase();
}
