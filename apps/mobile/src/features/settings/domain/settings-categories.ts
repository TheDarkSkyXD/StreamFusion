import type { SettingsPanelId } from "@streamfusion/core/settings";

export type SettingsCategorySectionId =
  "general" | "viewing" | "experience" | "accounts-network" | "system-support";

export type SettingsCategoryIconId =
  | "appearance"
  | "playback"
  | "player-controls"
  | "buffer"
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
  readonly descriptionKey: string | null;
  readonly icon: SettingsCategoryIconId;
  readonly id: SettingsPanelId;
  readonly section: SettingsCategorySectionId;
  readonly title: string;
  readonly titleKey: string;
};

export const SETTINGS_CATEGORY_SECTIONS: readonly {
  readonly id: SettingsCategorySectionId;
  readonly title: string;
  readonly titleKey: string;
}[] = [
  { id: "general", title: "General", titleKey: "settings.general2" },
  { id: "viewing", title: "Viewing", titleKey: "settings.viewing" },
  { id: "experience", title: "Experience", titleKey: "settings.experience" },
  {
    id: "accounts-network",
    title: "Accounts & Network",
    titleKey: "settings.accountsNetwork",
  },
  {
    id: "system-support",
    title: "System & Support",
    titleKey: "settings.systemSupport",
  },
];

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "appearance",
    section: "general",
    title: "General",
    titleKey: "settings.general2",
    description: "Language and app preferences",
    descriptionKey: "settings.languageAndAppPreferences",
    icon: "appearance",
  },
  {
    id: "playback",
    section: "viewing",
    title: "Playback",
    titleKey: "settings.playback",
    description: "Stream quality & preferences",
    descriptionKey: "settings.streamQualityPreferences",
    icon: "playback",
  },
  {
    id: "player-controls",
    section: "viewing",
    title: "Player controls",
    titleKey: "settings.playerControls",
    description: "Show or hide player buttons",
    descriptionKey: "settings.showOrHidePlayerButtons",
    icon: "player-controls",
  },
  {
    id: "buffer",
    section: "viewing",
    title: "Buffer",
    titleKey: "settings.buffer",
    description: "Live latency & stability",
    descriptionKey: "settings.liveLatencyStability",
    icon: "buffer",
  },
  {
    id: "notifications",
    section: "experience",
    title: "Notifications",
    titleKey: "settings.notifications",
    description: "Alerts on this device",
    descriptionKey: null,
    icon: "notifications",
  },
  {
    id: "chat",
    section: "experience",
    title: "Chat",
    titleKey: "settings.chat",
    description: "Appearance, emotes & events",
    descriptionKey: "settings.appearanceEmotesEvents",
    icon: "chat",
  },
  {
    id: "predictions",
    section: "experience",
    title: "Predictions",
    titleKey: "settings.predictions",
    description: "Chat prediction widget style",
    descriptionKey: "settings.chatPredictionWidgetStyle",
    icon: "predictions",
  },
  {
    id: "adblock",
    section: "accounts-network",
    title: "Ad-Block",
    titleKey: "settings.adBlock",
    description: "Twitch ad-blocking settings",
    descriptionKey: "settings.twitchAdBlockingSettings",
    icon: "adblock",
  },
  {
    id: "proxy",
    section: "accounts-network",
    title: "Proxy",
    titleKey: "settings.proxy",
    description: "Outbound connectivity preferences",
    descriptionKey: null,
    icon: "proxy",
  },
  {
    id: "integrations",
    section: "accounts-network",
    title: "Integrations",
    titleKey: "settings.integrations",
    description: "Connected accounts & APIs",
    descriptionKey: "settings.connectedAccountsApis",
    icon: "integrations",
  },
  {
    id: "api-tokens",
    section: "accounts-network",
    title: "API / Tokens",
    titleKey: "settings.apiTokens",
    description: "Sign-in & token status",
    descriptionKey: "settings.signInTokenStatus",
    icon: "api-tokens",
  },
  {
    id: "updates",
    section: "system-support",
    title: "Updates",
    titleKey: "settings.updates",
    description: "GitHub release checks",
    descriptionKey: null,
    icon: "updates",
  },
  {
    id: "diagnostics",
    section: "system-support",
    title: "Diagnostics",
    titleKey: "settings.diagnostics",
    description: "Capability profile and recovery",
    descriptionKey: null,
    icon: "diagnostics",
  },
  {
    id: "logs",
    section: "system-support",
    title: "Logs",
    titleKey: "settings.logs",
    description: "In-app log viewer & diagnostics",
    descriptionKey: "settings.inAppLogViewerDiagnostics",
    icon: "logs",
  },
  {
    id: "report-bug",
    section: "system-support",
    title: "Report Bug",
    titleKey: "settings.reportBug",
    description: "Capture a bug report for sharing",
    descriptionKey: "settings.captureABugReportForSharing",
    icon: "report-bug",
  },
  {
    id: "about",
    section: "system-support",
    title: "About",
    titleKey: "settings.about",
    description: "Version & info",
    descriptionKey: "settings.versionInfo",
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

export function settingsCategoryTitleKey(panel: SettingsPanelId): string {
  return CATEGORY_BY_ID.get(panel)?.titleKey ?? "settings.settings";
}
