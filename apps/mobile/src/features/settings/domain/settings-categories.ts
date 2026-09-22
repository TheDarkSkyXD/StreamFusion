import type { SettingsPanelId } from "@streamfusion/core/settings";

export type SettingsCategorySectionId = "customize" | "connections" | "support";

export type SettingsCategoryIconId =
  | "appearance"
  | "playback"
  | "player-controls"
  | "buffer"
  | "multiview"
  | "chat"
  | "predictions"
  | "notifications"
  | "adblock"
  | "proxy"
  | "integrations"
  | "api-tokens"
  | "updates"
  | "diagnostics"
  | "logs"
  | "report-bug"
  | "about";

export type SettingsCategory = {
  readonly description: string;
  readonly icon: SettingsCategoryIconId;
  readonly id: SettingsPanelId;
  readonly section: SettingsCategorySectionId;
  readonly title: string;
};

export const SETTINGS_CATEGORY_SECTIONS: readonly {
  readonly id: SettingsCategorySectionId;
  readonly title: string;
}[] = [
  { id: "customize", title: "Customize" },
  { id: "connections", title: "Connections" },
  { id: "support", title: "Support" },
];

/** Frosty-style hub catalog — one tile per existing settings panel. */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "appearance",
    section: "customize",
    title: "Appearance",
    description: "Density, language, and session restore",
    icon: "appearance",
  },
  {
    id: "playback",
    section: "customize",
    title: "Playback",
    description: "Quality, captions, HEVC, and device id",
    icon: "playback",
  },
  {
    id: "player-controls",
    section: "customize",
    title: "Player controls",
    description: "Chrome toggles and seek intervals",
    icon: "player-controls",
  },
  {
    id: "buffer",
    section: "customize",
    title: "Buffer",
    description: "Forward buffer, max buffer, live sync",
    icon: "buffer",
  },
  {
    id: "multiview",
    section: "customize",
    title: "Multiview",
    description: "Slot cap and background quality",
    icon: "multiview",
  },
  {
    id: "chat",
    section: "customize",
    title: "Chat",
    description: "Display density and message chrome",
    icon: "chat",
  },
  {
    id: "predictions",
    section: "customize",
    title: "Predictions",
    description: "Overlay and participation preferences",
    icon: "predictions",
  },
  {
    id: "notifications",
    section: "connections",
    title: "Notifications",
    description: "Live alerts on this device",
    icon: "notifications",
  },
  {
    id: "adblock",
    section: "connections",
    title: "Ad-blocking",
    description: "Twitch playlist proxy and filters",
    icon: "adblock",
  },
  {
    id: "proxy",
    section: "connections",
    title: "Proxy",
    description: "Outbound connectivity preferences",
    icon: "proxy",
  },
  {
    id: "integrations",
    section: "connections",
    title: "Integrations",
    description: "Twitch and Kick account links",
    icon: "integrations",
  },
  {
    id: "api-tokens",
    section: "connections",
    title: "API tokens",
    description: "Token status and rotation hints",
    icon: "api-tokens",
  },
  {
    id: "updates",
    section: "support",
    title: "Updates",
    description: "GitHub release checks",
    icon: "updates",
  },
  {
    id: "diagnostics",
    section: "support",
    title: "Diagnostics",
    description: "Capability profile and recovery",
    icon: "diagnostics",
  },
  {
    id: "logs",
    section: "support",
    title: "Logs",
    description: "Local support log buffer",
    icon: "logs",
  },
  {
    id: "report-bug",
    section: "support",
    title: "Report a bug",
    description: "Build a redacted diagnostic report",
    icon: "report-bug",
  },
  {
    id: "about",
    section: "support",
    title: "About",
    description: "Licenses, privacy, and reset actions",
    icon: "about",
  },
];

const CATEGORY_BY_ID = new Map(
  SETTINGS_CATEGORIES.map((category) => [category.id, category]),
);

export function settingsCategoryFor(
  panel: SettingsPanelId,
): SettingsCategory | undefined {
  return CATEGORY_BY_ID.get(panel);
}

export function settingsCategoriesForPanels(
  panels: readonly SettingsPanelId[],
): readonly SettingsCategory[] {
  const allowed = new Set(panels);
  return SETTINGS_CATEGORIES.filter((category) => allowed.has(category.id));
}

export function settingsCategoryTitle(panel: SettingsPanelId): string {
  return CATEGORY_BY_ID.get(panel)?.title ?? panel;
}
