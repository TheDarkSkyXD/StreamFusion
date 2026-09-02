import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IoMdSettings } from "react-icons/io";
import type { IconType } from "react-icons";
import { useTranslation } from "react-i18next";
import {
  LuActivity,
  LuBell,
  LuBug,
  LuChevronDown,
  LuCircleAlert,
  LuCircleCheck,
  LuCircleHelp,
  LuCircleX,
  LuDownload,
  LuEye,
  LuEyeOff,
  LuFileText,
  LuGauge,
  LuKeyRound,
  LuLayoutGrid,
  LuLink,
  LuMessageSquare,
  LuMonitor,
  LuNetwork,
  LuRefreshCw,
  LuRocket,
  LuSearch,
  LuShieldCheck,
  LuSlidersHorizontal,
  LuTriangleAlert,
  LuTrophy,
  LuX,
} from "react-icons/lu";

import streamFusionLogo from "@/assets/brand/streamfusion-logo.png";
import { AccountConnect } from "@/features/auth/components/auth/AccountConnect";
import {
  getAdBlockDeviceId,
  randomizeAdBlockDeviceId,
} from "@/features/playback/components/player/twitch/twitch-adblock-device-id";
import { isTwitchPlaylistProxyMode } from "@/features/playback/utils/twitch-playlist-proxy";
import { BugReportSection } from "@/features/settings/components/settings/BugReportSection";
import { ChatSettingsSection } from "@/features/settings/components/settings/ChatSettingsSection";
import { LogsSection } from "@/features/settings/components/settings/LogsSection";
import { TwitchPlaylistProxySettingsSection } from "@/features/settings/components/settings/TwitchPlaylistProxySettingsSection";
import { DisplayLanguageSelect } from "@/components/settings/DisplayLanguageSelect";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAppVersion, useAppVersionInfo, useUpdater } from "@/hooks";
import { useAfterFirstPaint } from "@/hooks/useAfterFirstPaint";
import { useAuthError } from "@/features/auth/data/useAuth";
import {
  getNotificationPreferences,
  isPerChannelNotificationEnabled,
  setPerChannelNotificationPreference,
} from "@/features/auth/utils/live-notification-preferences";
import { notifySettingsSaved } from "@/features/settings/utils/settings-toast";
import { cn } from "@/lib/utils";
import type { Platform } from "@shared/auth-types";
import {
  type BufferPreferences,
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  DEFAULT_PLAYBACK_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PREDICTION_PREFERENCES,
  DEFAULT_PROXY_PREFERENCES,
  type LiveNotificationCoverageStatus,
  type NotificationPreferences,
  type PlaybackAdvancedPlayerType,
  type PlaybackAdvancedPreferences,
  type PlayerControlsPreferences,
  type PredictionPreferences,
  type VideoQuality,
} from "@shared/auth-types";
import type { CheckFrequency, TokenStatusResult } from "@shared/ipc-channels";
import { useAdBlockStore } from "@/store/adblock-store";
import { i18n, resolveDisplayLanguage } from "@/i18n";
import type { settingsEn } from "@/i18n/locales/en/settings";
import {
  HOME_CAROUSEL_INTERVAL_MAX_MS,
  HOME_CAROUSEL_INTERVAL_MIN_MS,
  useAppStore,
} from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import {
  type BackgroundQuality,
  MULTIVIEW_PLAYBACK_BUDGET_MIN,
  useMultiStreamStore,
} from "@/features/multistream/data/multistream-store";
import { useSeekIntervalStore } from "@/store/seek-interval-store";

function translateSettings(
  key: `settings.${keyof typeof settingsEn.settings}`,
  options?: Record<string, unknown>
): string {
  const translated: string = i18n["t"](key, { defaultValue: String(key) });
  return options
    ? Object.entries(options).reduce(
        (result, [name, value]) => result.replaceAll(`{{${name}}}`, String(value)),
        translated
      )
    : translated;
}
const DiagnosticsWorkspace = lazy(() =>
  import("./diagnostics/DiagnosticsWorkspace").then((module) => ({
    default: module.DiagnosticsWorkspace,
  }))
);

const SETTINGS_TABS = [
  "general",
  "playback",
  "notifications",
  "player-controls",
  "buffer",
  "multiview",
  "chat",
  "adblock",
  "proxy",
  "predictions",
  "integrations",
  "api-tokens",
  "updates",
  "diagnostics",
  "logs",
  "report-bug",
  "about",
] as const;

// Tabs only visible when running under electron-vite dev (env.get().isDev).
// In packaged builds the corresponding sidebar items + content panels are
// suppressed entirely, and a deep-link `?tab=<dev-only>` is redirected to the
// default tab.
const DEV_ONLY_TABS = new Set<(typeof SETTINGS_TABS)[number]>(["logs", "report-bug"]);
const HOME_CAROUSEL_INTERVAL_STEP_SECONDS = 5;
const SEEK_INTERVAL_OPTIONS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const;

interface SeekIntervalSelectProps {
  id: string;
  descriptionId: string;
  value: number;
  onChange: (seconds: number) => void;
}

function SeekIntervalSelect({ id, descriptionId, value, onChange }: SeekIntervalSelectProps) {
  const [isCustom, setIsCustom] = useState(
    () => !SEEK_INTERVAL_OPTIONS.includes(value as (typeof SEEK_INTERVAL_OPTIONS)[number])
  );
  const selectedValue = isCustom ? "custom" : String(value);

  return (
    <div className="flex items-center gap-2">
      <Select
        value={selectedValue}
        onValueChange={(nextValue) => {
          if (nextValue === "custom") {
            setIsCustom(true);
            return;
          }
          setIsCustom(false);
          onChange(Number(nextValue));
        }}
      >
        <SelectTrigger
          aria-describedby={descriptionId}
          aria-label={
            id === "rewind-seconds"
              ? translateSettings("settings.rewind")
              : translateSettings("settings.fastForward")
          }
          className="h-10 w-32"
          id={id}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SEEK_INTERVAL_OPTIONS.map((seconds) => (
            <SelectItem key={seconds} value={String(seconds)}>
              {seconds} {translateSettings("settings.seconds")}
            </SelectItem>
          ))}
          <SelectItem value="custom">{translateSettings("settings.custom")}</SelectItem>
        </SelectContent>
      </Select>
      {isCustom && (
        <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background-tertiary)] pr-3 text-sm text-[var(--color-foreground-muted)] focus-within:ring-2 focus-within:ring-[var(--color-ring)]">
          <input
            aria-describedby={descriptionId}
            aria-label={translateSettings("settings.valueCustomSeconds", {
              value1: id === "rewind-seconds" ? "Rewind" : "Fast forward",
            })}
            className="h-10 w-20 rounded-l-lg bg-transparent px-3 text-right tabular-nums text-[var(--color-foreground)] outline-none"
            inputMode="numeric"
            min={0}
            onChange={(event) => {
              const seconds = event.currentTarget.valueAsNumber;
              if (Number.isSafeInteger(seconds) && seconds >= 0) onChange(seconds);
            }}
            step={1}
            type="number"
            value={value}
          />
          {translateSettings("settings.sec")}
        </div>
      )}
    </div>
  );
}

// Numeric buffer controls surfaced in Settings → Buffer (U10). Each maps to one
// BufferPreferences number field; ranges keep values in HLS.js-sane bounds.
const BUFFER_RANGE_CONTROLS: {
  field: Exclude<keyof BufferPreferences, "lowLatencyMode">;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}[] = [
  {
    field: "liveSyncDurationCount",
    label: i18n["t"]("settings.targetLiveLatency"),
    description: i18n["t"]("settings.segmentsFromTheLiveEdgeLowerStaysCloserToLiveButIsLessStable"),
    min: 1,
    max: 10,
    step: 1,
    unit: "seg",
  },
  {
    field: "maxBufferLengthSec",
    label: i18n["t"]("settings.forwardBuffer"),
    description: i18n["t"]("settings.secondsOfVideoBufferedAheadHigherResistsStallsButAddsLatency"),
    min: 5,
    max: 60,
    step: 1,
    unit: "s",
  },
  {
    field: "maxMaxBufferLengthSec",
    label: i18n["t"]("settings.maxBuffer"),
    description: i18n["t"]("settings.hardCapOnBufferedSecondsTheByteBudgetScalesWithThisValue"),
    min: 10,
    max: 120,
    step: 5,
    unit: "s",
  },
];

// Player-control visibility toggles surfaced in the Settings → Player controls tab (U9).
// Covers only the controls that actually render in the UI (wired in U8). Picture-in-Picture
// is intentionally omitted: no PiP control renders today, so a toggle would be a dead control
// (the `showPictureInPicture` pref field still exists, just unsurfaced here).
const PLAYER_CONTROL_TOGGLES: {
  field: Exclude<keyof PlayerControlsPreferences, "showPictureInPicture">;
  label: string;
  description?: string;
}[] = [
  {
    field: "showQuality",
    label: i18n["t"]("settings.quality"),
    description: i18n["t"]("settings.streamQualitySelectorMenuItem"),
  },
  {
    field: "showPlaybackSpeed",
    label: i18n["t"]("settings.playbackSpeed"),
    description: i18n["t"]("settings.speedSelectorVodPlayback"),
  },
  {
    field: "showVolume",
    label: i18n["t"]("settings.volume"),
    description: i18n["t"]("settings.volumeSliderAndMuteButton"),
  },
  {
    field: "showFullscreen",
    label: i18n["t"]("settings.fullscreen"),
    description: i18n["t"]("settings.fullscreenToggleButton"),
  },
  {
    field: "showTheater",
    label: i18n["t"]("settings.theater"),
    description: i18n["t"]("settings.theaterModeToggleButton"),
  },
  {
    field: "showVideoStats",
    label: i18n["t"]("settings.videoStats"),
    description: i18n["t"]("settings.liveVideoStatsOverlay"),
  },
];

// Player-type options for the advanced stream-token control (U13). "default" is
// the behavior-neutral sentinel; the rest are the ad-block `PlayerType` union.
const PLAYBACK_ADVANCED_PLAYER_TYPES: { value: PlaybackAdvancedPlayerType; label: string }[] = [
  { value: "default", label: i18n["t"]("settings.defaultRecommended") },
  { value: "site", label: i18n["t"]("settings.site") },
  { value: "embed", label: i18n["t"]("settings.embed") },
  { value: "popout", label: i18n["t"]("settings.popout") },
  { value: "autoplay", label: i18n["t"]("settings.autoplay") },
  { value: "picture-by-picture", label: i18n["t"]("settings.pictureByPicture") },
  { value: "thunderdome", label: i18n["t"]("settings.thunderdome") },
];

const NOTIFICATION_TOGGLES: {
  field: Exclude<
    keyof NotificationPreferences,
    "restartGracePeriodMinutes" | "perChannelNotifications"
  >;
  label: string;
  description: string;
}[] = [
  {
    field: "enabled",
    label: i18n["t"]("settings.desktopNotifications"),
    description: i18n["t"]("settings.showNativeOsNotificationsWhenFollowedStreamsGoLive"),
  },
  {
    field: "liveAlerts",
    label: i18n["t"]("settings.liveNotifications"),
    description: i18n["t"]("settings.keepLiveStreamAlertsInTheAppNotificationHistory"),
  },
  {
    field: "twitch",
    label: "Twitch",
    description: i18n["t"]("settings.allowLiveNotificationsFromTwitch"),
  },
  {
    field: "kick",
    label: "Kick",
    description: i18n["t"]("settings.allowLiveNotificationsFromKick"),
  },
  {
    field: "guestFollows",
    label: i18n["t"]("settings.guestFollowNotifications"),
    description: i18n["t"]("settings.notifyForChannelsFollowedWhileSignedOut"),
  },
  {
    field: "toastAlerts",
    label: i18n["t"]("settings.toastNotifications"),
    description: i18n["t"]("settings.showInAppToastBannersWhenFollowedStreamsGoLive"),
  },
  {
    field: "sound",
    label: i18n["t"]("settings.sound"),
    description: i18n["t"]("settings.playANotificationSound"),
  },
  {
    field: "favoriteChannelsOnly",
    label: i18n["t"]("settings.favoritesOnly"),
    description: i18n["t"](
      "settings.onlyNotifyForFollowedChannelsWithPerChannelNotificationsEnabled"
    ),
  },
];

const RESTART_GRACE_OPTIONS: {
  value: NotificationPreferences["restartGracePeriodMinutes"];
  label: string;
}[] = [
  { value: 0, label: i18n["t"]("settings.off") },
  { value: 5, label: i18n["t"]("settings.value5Minutes") },
  { value: 15, label: i18n["t"]("settings.value15Minutes") },
  { value: 30, label: i18n["t"]("settings.value30Minutes") },
];

// Per-tab metadata (sidebar label, description, icon). Single source of truth
// for the sidebar render + the settings-search haystack, so adding a tab only
// needs editing in one place.
type TabKey = (typeof SETTINGS_TABS)[number];
const TAB_META: Record<TabKey, { label: string; description: string; icon: typeof LuMonitor }> = {
  general: {
    label: i18n["t"]("settings.general2"),
    description: i18n["t"]("settings.languageAndAppPreferences"),
    icon: LuSlidersHorizontal,
  },
  playback: {
    label: i18n["t"]("settings.playback"),
    description: i18n["t"]("settings.streamQualityPreferences"),
    icon: LuMonitor,
  },
  notifications: {
    label: i18n["t"]("settings.notifications"),
    description: i18n["t"]("settings.liveAlertsDesktopNotices"),
    icon: LuBell,
  },
  "player-controls": {
    label: i18n["t"]("settings.playerControls"),
    description: i18n["t"]("settings.showOrHidePlayerButtons"),
    icon: LuSlidersHorizontal,
  },
  buffer: {
    label: i18n["t"]("settings.buffer"),
    description: i18n["t"]("settings.liveLatencyStability"),
    icon: LuGauge,
  },
  multiview: {
    label: i18n["t"]("settings.multiview"),
    description: i18n["t"]("settings.slotCountMemoryTradeOff"),
    icon: LuLayoutGrid,
  },
  chat: {
    label: i18n["t"]("settings.chat"),
    description: i18n["t"]("settings.appearanceEmotesEvents"),
    icon: LuMessageSquare,
  },
  adblock: {
    label: i18n["t"]("settings.adBlock"),
    description: i18n["t"]("settings.twitchAdBlockingSettings"),
    icon: LuShieldCheck,
  },
  proxy: {
    label: i18n["t"]("settings.proxy"),
    description: i18n["t"]("settings.proxyDefaultSessionChromiumRequests"),
    icon: LuNetwork,
  },
  predictions: {
    label: i18n["t"]("settings.predictions"),
    description: i18n["t"]("settings.chatPredictionWidgetStyle"),
    icon: LuTrophy,
  },
  integrations: {
    label: i18n["t"]("settings.integrations"),
    description: i18n["t"]("settings.connectedAccountsApis"),
    icon: LuLink,
  },
  "api-tokens": {
    label: i18n["t"]("settings.apiTokens"),
    description: i18n["t"]("settings.signInTokenStatus"),
    icon: LuKeyRound,
  },
  updates: {
    label: i18n["t"]("settings.updates"),
    description: i18n["t"]("settings.autoUpdatePreferences"),
    icon: LuRefreshCw,
  },
  diagnostics: {
    label: i18n["t"]("settings.diagnostics"),
    description: i18n["t"]("settings.inspectLivePerformanceProcessesTracesAndLogs"),
    icon: LuActivity,
  },
  logs: {
    label: i18n["t"]("settings.logs"),
    description: i18n["t"]("settings.inAppLogViewerDiagnostics"),
    icon: LuFileText,
  },
  "report-bug": {
    label: i18n["t"]("settings.reportBug"),
    description: i18n["t"]("settings.captureABugReportForSharing"),
    icon: LuBug,
  },
  about: {
    label: i18n["t"]("settings.about"),
    description: i18n["t"]("settings.versionInfo"),
    icon: LuCircleHelp,
  },
};

const SETTINGS_GROUPS: ReadonlyArray<{ label: string; tabs: readonly TabKey[] }> = [
  { label: i18n["t"]("settings.general2"), tabs: ["general"] },
  {
    label: i18n["t"]("settings.viewing"),
    tabs: ["playback", "player-controls", "buffer", "multiview"],
  },
  {
    label: i18n["t"]("settings.experience"),
    tabs: ["notifications", "chat", "predictions"],
  },
  {
    label: i18n["t"]("settings.accountsNetwork"),
    tabs: ["adblock", "proxy", "integrations", "api-tokens"],
  },
  {
    label: i18n["t"]("settings.systemSupport"),
    tabs: ["updates", "diagnostics", "logs", "report-bug", "about"],
  },
];

// Searchable index of individual settings. Each entry's match haystack also
// pulls in its tab's label/description, so typing a tab name surfaces every
// row underneath. Keywords cover values a user might type that aren't in the
// visible label (e.g. "1080p" → Default Quality, "h265" → Allow HEVC).
type SettingsIndexEntry = {
  tab: TabKey;
  label: string;
  description?: string;
  keywords?: string[];
};
const SETTINGS_INDEX: SettingsIndexEntry[] = [
  {
    tab: "general",
    label: i18n["t"]("settings.displayLanguage2"),
    description: i18n["t"]("settings.chooseTheLanguageUsedByStreamfusionSInterface"),
    keywords: ["language", "locale", "english", "spanish"],
  },
  {
    tab: "playback",
    label: i18n["t"]("settings.defaultQuality"),
    description: i18n["t"]("settings.preferredStreamQualityWhenAvailable"),
    keywords: [
      "highest",
      "source",
      "1440p",
      "2k",
      "1080p",
      "720p",
      "480p",
      "360p",
      "160p",
      "auto",
      "resolution",
    ],
  },
  {
    tab: "playback",
    label: i18n["t"]("settings.featuredCarouselTiming"),
    description: i18n["t"]("settings.howLongEachHomePageFeaturedStreamStaysActive"),
    keywords: ["home", "featured", "banner", "carousel", "rotate", "seconds", "minutes"],
  },
  {
    tab: "playback",
    label: i18n["t"]("settings.accessTokenPlayerType"),
    description: i18n["t"]("settings.playerTypeUsedWhenRequestingTheAdBlockStreamToken"),
    keywords: ["advanced", "site", "embed", "popout", "autoplay", "thunderdome"],
  },
  {
    tab: "playback",
    label: i18n["t"]("settings.allowHevcH265"),
    description: i18n["t"]("settings.keepHevcStreamsInsteadOfSwappingToAvcDuringAds"),
    keywords: ["codec", "h265", "advanced"],
  },
  {
    tab: "playback",
    label: i18n["t"]("settings.streamDeviceId"),
    description: i18n["t"]("settings.identifierSentWithTheAdBlockStreamToken"),
    keywords: ["randomize", "device", "advanced"],
  },
  {
    tab: "notifications",
    label: i18n["t"]("settings.desktopNotifications"),
    description: i18n["t"]("settings.allowNativeDesktopNotificationsWhenFollowedStreamsGoLive"),
    keywords: ["native", "system", "toast"],
  },
  {
    tab: "notifications",
    label: i18n["t"]("settings.liveNotifications"),
    description: i18n["t"](
      "settings.createLiveNotificationHistoryEntriesWhenFollowedStreamsGoLive"
    ),
    keywords: ["stream", "live", "history"],
  },
  {
    tab: "notifications",
    label: "Twitch",
    description: i18n["t"]("settings.allowTwitchLiveNotifications"),
  },
  {
    tab: "notifications",
    label: "Kick",
    description: i18n["t"]("settings.allowKickLiveNotifications"),
  },
  {
    tab: "notifications",
    label: i18n["t"]("settings.guestFollowNotifications"),
    description: i18n["t"]("settings.notifyForChannelsFollowedWhileSignedOut2"),
    keywords: ["guest", "signed out", "local follows"],
  },
  {
    tab: "notifications",
    label: i18n["t"]("settings.toastNotifications"),
    description: i18n["t"]("settings.showInAppToastBannersWhenFollowedStreamsGoLive2"),
    keywords: ["toast", "banner", "in-app"],
  },
  {
    tab: "notifications",
    label: i18n["t"]("settings.sound"),
    description: i18n["t"]("settings.playASoundWithNotifications"),
  },
  {
    tab: "notifications",
    label: i18n["t"]("settings.favoritesOnly"),
    description: i18n["t"](
      "settings.onlyNotifyForFollowedChannelsWithPerChannelNotificationsEnabled2"
    ),
    keywords: ["favorites", "followed channels"],
  },
  {
    tab: "notifications",
    label: i18n["t"]("settings.restartGrace"),
    description: i18n["t"]("settings.cooldownBeforeRepeatNotificationsAfterStreamRestarts"),
    keywords: ["cooldown", "restarts", "grace"],
  },
  {
    tab: "notifications",
    label: i18n["t"]("settings.perChannelNotifications"),
    description: i18n["t"](
      "settings.chooseWhichFollowedChannelsAreEligibleWhenFavoritesOnlyIsEnabled"
    ),
    keywords: ["favorites", "followed channels"],
  },
  {
    tab: "notifications",
    label: i18n["t"]("settings.notificationCoverage"),
    description: i18n["t"]("settings.statusForDesktopSupportAndDegradedLiveSourceCoverage"),
    keywords: ["support", "degraded", "status"],
  },
  // Player controls — array entries (one per toggle in PLAYER_CONTROL_TOGGLES).
  {
    tab: "player-controls",
    label: i18n["t"]("settings.quality"),
    description: i18n["t"]("settings.streamQualitySelectorMenuItem"),
  },
  {
    tab: "player-controls",
    label: i18n["t"]("settings.playbackSpeed"),
    description: i18n["t"]("settings.speedSelectorVodPlayback"),
  },
  {
    tab: "player-controls",
    label: i18n["t"]("settings.volume"),
    description: i18n["t"]("settings.volumeSliderAndMuteButton"),
  },
  {
    tab: "player-controls",
    label: i18n["t"]("settings.fullscreen"),
    description: i18n["t"]("settings.fullscreenToggleButton"),
  },
  {
    tab: "player-controls",
    label: i18n["t"]("settings.theater"),
    description: i18n["t"]("settings.theaterModeToggleButton"),
  },
  {
    tab: "player-controls",
    label: i18n["t"]("settings.videoStats"),
    description: i18n["t"]("settings.liveVideoStatsOverlay"),
  },
  {
    tab: "player-controls",
    label: i18n["t"]("settings.rewind"),
    description: i18n["t"]("settings.secondsSkippedBackwardInVodsAndClips"),
    keywords: ["seek", "interval", "backward", "seconds", "VOD", "clip"],
  },
  {
    tab: "player-controls",
    label: i18n["t"]("settings.fastForward"),
    description: i18n["t"]("settings.secondsSkippedForwardInVodsAndClips"),
    keywords: ["seek", "interval", "forward", "seconds", "VOD", "clip"],
  },
  // Buffer
  {
    tab: "buffer",
    label: i18n["t"]("settings.lowLatencyMode"),
    description: i18n["t"]("settings.trackTheLiveEdgeAggressively"),
    keywords: ["latency"],
  },
  {
    tab: "buffer",
    label: i18n["t"]("settings.targetLiveLatency"),
    description: i18n["t"]("settings.segmentsFromTheLiveEdge"),
    keywords: ["livesync"],
  },
  {
    tab: "buffer",
    label: i18n["t"]("settings.forwardBuffer"),
    description: i18n["t"]("settings.secondsOfVideoBufferedAhead"),
  },
  {
    tab: "buffer",
    label: i18n["t"]("settings.maxBuffer"),
    description: i18n["t"]("settings.hardCapOnBufferedSeconds"),
  },
  // Multiview (slice 03 + slice 08 background-quality row).
  {
    tab: "multiview",
    label: i18n["t"]("settings.concurrentPlaybackBudget"),
    description: i18n["t"](
      "settings.numberOfSimultaneousVideoDecodersLayoutMembershipStaysUnbounded"
    ),
    keywords: ["multistream", "slots", "budget", "ram", "memory", "grid", "tiles"],
  },
  {
    tab: "multiview",
    label: i18n["t"]("settings.backgroundStreamQuality"),
    description: i18n["t"]("settings.howNonFocusedSlotsRenderAutoLowMatchSourceOff"),
    keywords: ["background", "quality", "480p", "ram", "memory", "auto-low", "match-source"],
  },
  // Chat — content delegated to ChatSettingsSection. One umbrella entry so the
  // tab surfaces for "emotes", "events", "bttv", etc.
  {
    tab: "chat",
    label: i18n["t"]("settings.chat"),
    description: i18n["t"]("settings.appearanceEmotesEventsBehavior"),
    keywords: ["bttv", "7tv", "ffz", "raid", "sub", "emote", "events", "messages"],
  },
  {
    tab: "adblock",
    label: i18n["t"]("settings.enableAdBlocking"),
    description: i18n["t"]("settings.blockTwitchAdsUsingAlternativePlayerTokens"),
    keywords: ["vaft"],
  },
  // Proxy — listed per-field so any field name jumps to the tab, but the form
  // renders as a single unit so users see the full context.
  {
    tab: "proxy",
    label: i18n["t"]("settings.twitchPlaylistProxy"),
    description: i18n["t"](
      "settings.replaceTheCustomTwitchAdBlockerWithOrderedPlaylistProxySources"
    ),
    keywords: ["playlist", "fallback", "ad block", "ad blocker"],
  },
  {
    tab: "proxy",
    label: i18n["t"]("settings.playlistProxySources"),
    description: i18n["t"]("settings.enableReorderAddEditOrRemovePlaylistSources"),
    keywords: ["list", "order", "status", "online", "offline", "health"],
  },
  {
    tab: "proxy",
    label: i18n["t"]("settings.enableProxy"),
    description: i18n["t"]("settings.routesDefaultSessionChromiumRequestsThroughTheHost"),
  },
  {
    tab: "proxy",
    label: i18n["t"]("settings.host"),
    description: i18n["t"]("settings.proxyHostOrIp"),
    keywords: ["server"],
  },
  {
    tab: "proxy",
    label: i18n["t"]("settings.port"),
    description: i18n["t"]("settings.proxyPortNumber"),
  },
  {
    tab: "proxy",
    label: i18n["t"]("settings.credentials"),
    description: i18n["t"]("settings.usernameAndPasswordForTheProxy"),
    keywords: ["username", "password", "auth"],
  },
  {
    tab: "proxy",
    label: i18n["t"]("settings.networkLibrary"),
    description: i18n["t"]("settings.chromiumBuiltInProxyAwareNetworkEngine"),
    keywords: ["chromium", "electron", "manifest", "websocket", "direct partition", "http"],
  },
  {
    tab: "predictions",
    label: i18n["t"]("settings.style"),
    description: i18n["t"]("settings.visualStyleForTheChatPredictionWidget"),
    keywords: ["native", "unified"],
  },
  {
    tab: "integrations",
    label: i18n["t"]("settings.connectedAccounts"),
    description: i18n["t"]("settings.twitchAndKickAccountConnections"),
    keywords: ["sign in", "login", "auth"],
  },
  {
    tab: "api-tokens",
    label: i18n["t"]("settings.tokenStatus"),
    description: i18n["t"]("settings.signInAndTokenValidity"),
    keywords: ["scopes", "expiry", "twitch", "kick"],
  },
  {
    tab: "updates",
    label: i18n["t"]("settings.allowPreReleaseUpdates"),
    description: i18n["t"]("settings.receiveBetaAndPreviewVersionsBeforeStableRelease"),
    keywords: ["beta"],
  },
  {
    tab: "updates",
    label: i18n["t"]("settings.checkForUpdatesOnStartup"),
    description: i18n["t"]("settings.checkForNewVersionsInTheBackgroundOnASchedule"),
  },
  {
    tab: "updates",
    label: i18n["t"]("settings.checkFrequency"),
    description: i18n["t"]("settings.howOftenToCheckWhenAutomaticUpdatesAreOn"),
    keywords: ["hourly", "daily", "weekly"],
  },
  {
    tab: "updates",
    label: i18n["t"]("settings.checkForUpdates"),
    description: i18n["t"]("settings.checkForAvailableUpdatesNow"),
  },
  {
    tab: "diagnostics",
    label: i18n["t"]("settings.diagnostics"),
    description: i18n["t"]("settings.resourcesProcessesTracesFailuresLogsAndReports"),
  },
  {
    tab: "logs",
    label: i18n["t"]("settings.logs"),
    description: i18n["t"]("settings.inAppLogViewerAndDiagnostics"),
  },
  {
    tab: "report-bug",
    label: i18n["t"]("settings.reportABug"),
    description: i18n["t"]("settings.generateABugReportFile"),
  },
  {
    tab: "about",
    label: i18n["t"]("settings.about"),
    description: i18n["t"]("settings.versionAndInfo"),
  },
];

export function SettingsPage() {
  const { t } = useTranslation();
  const canRenderSettingsPanel = useAfterFirstPaint();
  const appVersion = useAppVersion();
  const versionInfo = useAppVersionInfo();
  const navigate = useNavigate();
  // Dev gate. While the env probe is in flight we conservatively treat the
  // build as prod so dev-only panels never flash in a packaged install.
  const [isDev, setIsDev] = useState(false);
  const [isDevResolved, setIsDevResolved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.env
      ?.get()
      .then((env) => {
        if (!cancelled) {
          setIsDev(env.isDev);
          setIsDevResolved(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsDev(false);
          setIsDevResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep-link support (e.g. the in-chat gear's "More settings" → /settings?tab=chat, U7).
  // Dev-only tabs requested in prod fall back to the default ("playback") so a
  // stale `?tab=logs` from a dev session doesn't land users on a blank panel.
  const search = useSearch({ from: "/_app/settings" });
  const requestedTab = search.tab as (typeof SETTINGS_TABS)[number];
  const isValidTab = SETTINGS_TABS.includes(requestedTab);
  const requestedIsDevOnly = isValidTab && DEV_ONLY_TABS.has(requestedTab);
  const urlActiveTab: TabKey =
    isValidTab && (!requestedIsDevOnly || isDev) ? requestedTab : "playback";
  const [pendingTab, setPendingTab] = useState<{ tab: TabKey; from: TabKey } | null>(null);
  const activeTab = pendingTab?.from === urlActiveTab ? pendingTab.tab : urlActiveTab;
  const contentScrollerRef = useRef<HTMLDivElement>(null);
  const previousActiveTabRef = useRef(activeTab);

  // The URL remains authoritative for deep links and Back/Forward navigation.
  // A pending selection renders immediately only while the URL remains at the
  // location it started from, so later history changes never show stale content.
  useEffect(() => {
    if (pendingTab && pendingTab.from !== urlActiveTab) setPendingTab(null);
  }, [pendingTab, urlActiveTab]);

  useEffect(() => {
    if (previousActiveTabRef.current === activeTab) return;
    previousActiveTabRef.current = activeTab;
    if (contentScrollerRef.current) contentScrollerRef.current.scrollTop = 0;
  }, [activeTab]);

  const resetContentScroll = useCallback(() => {
    if (contentScrollerRef.current) contentScrollerRef.current.scrollTop = 0;
  }, []);

  const navigateToTab = useCallback(
    (tab: TabKey, replace = false, optimistic = false) => {
      if (optimistic) setPendingTab({ tab, from: urlActiveTab });
      try {
        void Promise.resolve(navigate({ to: "/settings", search: { tab }, replace })).catch(() => {
          setPendingTab(null);
        });
      } catch {
        setPendingTab(null);
      }
    },
    [navigate, urlActiveTab]
  );

  // Keep the query parameter canonical while waiting for the environment
  // probe before deciding whether a developer-only deep link is allowed.
  useEffect(() => {
    if (!isValidTab) {
      navigateToTab("playback", true);
      return;
    }
    if (requestedIsDevOnly && isDevResolved && !isDev) {
      navigateToTab("playback", true);
    }
  }, [isValidTab, requestedIsDevOnly, isDevResolved, isDev, navigateToTab]);

  // ===== Settings search =====
  // Filters the sidebar to tabs containing matching settings and, within the
  // active tab, hides rows whose labels don't match. Empty query → everything
  // renders (search is inert). Named `searchMatches` to avoid colliding with
  // the router's `search` (URL search params) declared above.
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedQuery = searchQuery.trim().toLowerCase();

  const searchMatches = useMemo(() => {
    if (!normalizedQuery) {
      return { active: false, tabs: null as Set<TabKey> | null, rows: null as Set<string> | null };
    }
    const tabs = new Set<TabKey>();
    const rows = new Set<string>();
    for (const entry of SETTINGS_INDEX) {
      const tabInfo = TAB_META[entry.tab];
      const haystack = [
        entry.label,
        entry.description ?? "",
        (entry.keywords ?? []).join(" "),
        tabInfo.label,
        tabInfo.description,
      ]
        .join(" ")
        .toLowerCase();
      if (haystack.includes(normalizedQuery)) {
        tabs.add(entry.tab);
        rows.add(`${entry.tab}:${entry.label.toLowerCase()}`);
      }
    }
    return { active: true, tabs, rows };
  }, [normalizedQuery]);

  // Visibility helpers used by tab content. `isRowVisible` defaults to true when
  // search is inactive so the existing JSX renders unchanged.
  const isRowVisible = (label: string): boolean => {
    if (!searchMatches.active || !searchMatches.rows) return true;
    return searchMatches.rows.has(`${activeTab}:${label.toLowerCase()}`);
  };
  const anyRowVisible = (...labels: string[]): boolean => labels.some((l) => isRowVisible(l));

  // Auto-jump: if the user types a query that filters the active tab out of the
  // sidebar, switch to the first remaining tab so the panel area isn't empty.
  // Dev-only tabs are skipped in prod.
  useEffect(() => {
    if (!searchMatches.active || !searchMatches.tabs) return;
    if (searchMatches.tabs.has(activeTab as TabKey)) return;
    const firstMatch = SETTINGS_TABS.find(
      (t) => searchMatches.tabs!.has(t) && (!DEV_ONLY_TABS.has(t) || isDev)
    );
    if (firstMatch) navigateToTab(firstMatch, true, true);
  }, [searchMatches, activeTab, isDev, navigateToTab]);

  // True iff the currently active tab has at least one matching setting (or
  // search is inactive). When false, the content area renders an empty state.
  const activeTabHasMatches =
    !searchMatches.active || (searchMatches.tabs?.has(activeTab as TabKey) ?? false);
  const hasVisibleTabMatches =
    !searchMatches.active ||
    SETTINGS_TABS.some((tab) => searchMatches.tabs?.has(tab) && (!DEV_ONLY_TABS.has(tab) || isDev));

  // Get auth state
  const { error, clearError } = useAuthError();
  const preferences = useAuthStore((state) => state.preferences);
  const updatePreferences = useAuthStore((state) => state.updatePreferences);
  const followedChannels = useFollowStore((state) => state.localFollows);

  // Ad-block state
  const enableAdBlock = useAdBlockStore((state) => state.enableAdBlock);
  const isPlaylistProxyEnabled = isTwitchPlaylistProxyMode(preferences);
  const setEnableAdBlock = useAdBlockStore((state) => state.setEnableAdBlock);

  const homeCarouselIntervalMs = useAppStore((state) => state.homeCarouselIntervalMs);
  const setHomeCarouselIntervalMs = useAppStore((state) => state.setHomeCarouselIntervalMs);
  const homeCarouselIntervalSeconds = Math.round(homeCarouselIntervalMs / 1000);
  const homeCarouselIntervalMinSeconds = HOME_CAROUSEL_INTERVAL_MIN_MS / 1000;
  const homeCarouselIntervalMaxSeconds = HOME_CAROUSEL_INTERVAL_MAX_MS / 1000;
  const handleHomeCarouselIntervalChange = (seconds: number) => {
    setHomeCarouselIntervalMs(seconds * 1000);
    notifySettingsSaved();
  };

  // Layout membership is unbounded. The playback budget controls decoder
  // concurrency; BackgroundQuality controls non-focused slots.
  const playbackBudget = useMultiStreamStore((state) => state.playbackBudget);
  const setPlaybackBudget = useMultiStreamStore((state) => state.setPlaybackBudget);
  const backgroundQuality = useMultiStreamStore((state) => state.backgroundQuality);
  const setBackgroundQualityInStore = useMultiStreamStore((state) => state.setBackgroundQuality);
  const handlePlaybackBudgetChange = (next: number) => {
    setPlaybackBudget(next);
    void window.electronAPI?.slot?.setPlaybackBudget?.(next);
    notifySettingsSaved();
  };
  const handleBackgroundQualityChange = (next: BackgroundQuality) => {
    // Persist locally + push to main so currently-background WCV slots
    // reconfigure live (slice 07 wired the controller-side fan-out).
    setBackgroundQualityInStore(next);
    window.electronAPI?.slot?.setBackgroundQuality(next).catch(() => {
      // No main-process listener in dev or a brief startup window — the
      // persisted value still drives new slot starts; nothing to surface.
    });
    notifySettingsSaved();
  };

  const handleQualityChange = async (value: string) => {
    // Cast string to VideoQuality since we know the values are valid
    const quality = value as VideoQuality;

    // Update store
    await updatePreferences({
      playback: {
        ...(preferences?.playback || DEFAULT_PLAYBACK_PREFERENCES),
        defaultQuality: quality,
      },
    });

    notifySettingsSaved();
  };

  const handlePredictionStyleChange = async (value: string) => {
    const style = value as PredictionPreferences["style"];
    await updatePreferences({
      predictions: {
        ...(preferences?.predictions ?? DEFAULT_PREDICTION_PREFERENCES),
        style,
      },
    });
    notifySettingsSaved();
  };

  const handlePlayerControlToggle = async (
    field: keyof PlayerControlsPreferences,
    value: boolean
  ) => {
    await updatePreferences({
      playerControls: {
        ...(preferences?.playerControls ?? DEFAULT_PLAYER_CONTROLS_PREFERENCES),
        [field]: value,
      },
    });
    notifySettingsSaved();
  };

  const playerControls = preferences?.playerControls ?? DEFAULT_PLAYER_CONTROLS_PREFERENCES;
  const rewindSeconds = useSeekIntervalStore((state) => state.rewindSeconds);
  const setRewindSeconds = useSeekIntervalStore((state) => state.setRewindSeconds);
  const forwardSeconds = useSeekIntervalStore((state) => state.forwardSeconds);
  const setForwardSeconds = useSeekIntervalStore((state) => state.setForwardSeconds);
  const buffer = preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES;
  const notifications = getNotificationPreferences(preferences?.notifications);

  const handleNotificationChange = async (
    field: Exclude<keyof NotificationPreferences, "perChannelNotifications">,
    value: boolean | NotificationPreferences["restartGracePeriodMinutes"]
  ) => {
    await updatePreferences({
      notifications: {
        ...notifications,
        [field]: value,
      },
    });
    notifySettingsSaved();
  };

  const handlePerChannelNotificationChange = async (
    channel: (typeof followedChannels)[number],
    value: boolean
  ) => {
    await updatePreferences({
      notifications: setPerChannelNotificationPreference(notifications, channel, value),
    });
    notifySettingsSaved();
  };
  const desktopNotificationsSupported = typeof window !== "undefined" && "Notification" in window;
  const desktopNotificationPermission = desktopNotificationsSupported
    ? window.Notification.permission
    : "unsupported";
  const [notificationCoverage, setNotificationCoverage] =
    useState<LiveNotificationCoverageStatus | null>(null);
  const [followedChannelSearch, setFollowedChannelSearch] = useState("");
  const [followedChannelNotificationsExpanded, setFollowedChannelNotificationsExpanded] =
    useState(true);

  const filteredFollowedChannels = useMemo(() => {
    const query = followedChannelSearch.trim().toLowerCase();
    if (!query) return followedChannels;
    return followedChannels.filter((channel) =>
      [channel.displayName, channel.username, channel.platform]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [followedChannels, followedChannelSearch]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.notifications
      ?.getCoverageStatus?.()
      .then((status) => {
        if (!cancelled) setNotificationCoverage(status);
      })
      .catch(() => {
        if (!cancelled) setNotificationCoverage(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleBufferChange = async (field: keyof BufferPreferences, value: number | boolean) => {
    await updatePreferences({
      buffer: {
        ...(preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES),
        [field]: value,
      },
    });
    notifySettingsSaved();
  };

  const handleBufferReset = async () => {
    await updatePreferences({ buffer: { ...DEFAULT_BUFFER_PREFERENCES } });
    notifySettingsSaved();
  };

  // ===== Advanced stream-token (U13) =====
  // Surfaced under Playback. Overrides flow ONLY through the ad-block (VAFT)
  // token pipeline (`updateAdBlockConfig` at player mount) — never the resolver
  // path, which uses a different Client-Id. Defaults are behavior-neutral.
  const playbackAdvanced = preferences?.playbackAdvanced ?? DEFAULT_PLAYBACK_ADVANCED_PREFERENCES;

  const handlePlaybackAdvancedChange = async (
    field: keyof PlaybackAdvancedPreferences,
    value: PlaybackAdvancedPlayerType | boolean
  ) => {
    await updatePreferences({
      playbackAdvanced: {
        ...(preferences?.playbackAdvanced ?? DEFAULT_PLAYBACK_ADVANCED_PREFERENCES),
        [field]: value,
      },
    });
    notifySettingsSaved();
  };

  // Device-id is a localStorage value (not a pref). Seed the displayed id on
  // mount; "Randomize" clears + regenerates it and updates the display. It takes
  // effect on the next stream load (the player remount re-seeds).
  const [adBlockDeviceId, setAdBlockDeviceId] = useState<string | null>(null);
  useEffect(() => {
    setAdBlockDeviceId(getAdBlockDeviceId());
  }, []);
  const handleRandomizeDeviceId = () => {
    setAdBlockDeviceId(randomizeAdBlockDeviceId());
    notifySettingsSaved(translateSettings("settings.streamDeviceIdRandomized"));
  };

  // ===== Proxy (U12) =====
  // Drives the U11 main-process proxy. `enabled`/`host`/`port` persist to
  // `preferences.proxy`; credentials are write-only (encrypted in main, never
  // round-tripped) and flow only through `proxy.setCredentials`.
  const proxyPrefs = preferences?.proxy ?? DEFAULT_PROXY_PREFERENCES;
  const [proxyEnabled, setProxyEnabled] = useState(proxyPrefs.enabled);
  const [proxyHost, setProxyHost] = useState(proxyPrefs.host);
  // Port is kept as a string for the controlled input; parsed/validated on use.
  const [proxyPort, setProxyPort] = useState(
    proxyPrefs.port == null ? "" : String(proxyPrefs.port)
  );
  const [proxyUsername, setProxyUsername] = useState("");
  // Write-only: empty means "leave the stored password unchanged".
  const [proxyPassword, setProxyPassword] = useState("");
  const [showProxyPassword, setShowProxyPassword] = useState(false);
  const [proxyPortError, setProxyPortError] = useState<string | null>(null);
  // Persistent in-section banner for an apply-IPC failure (not a toast).
  const [proxyApplyError, setProxyApplyError] = useState<string | null>(null);
  // Status line: "saved" (applied), "disabled" (enabled but no host), or null.
  const [proxyStatus, setProxyStatus] = useState<"saved" | "disabled" | null>(null);
  // Advisory: whether encrypted credentials are stored in main. Drives the
  // saved-password placeholder. Seeded from `proxy.hasCredentials()` on mount.
  const [proxyHasCredentials, setProxyHasCredentials] = useState(proxyPrefs.hasCredentials);

  // Re-sync the host/port/enabled inputs to persisted prefs (e.g. when the auth
  // store finishes hydrating). The form's own save is the only writer of these,
  // so this is idempotent and won't clobber unsaved typing in practice.
  useEffect(() => {
    setProxyEnabled(proxyPrefs.enabled);
    setProxyHost(proxyPrefs.host);
    setProxyPort(proxyPrefs.port == null ? "" : String(proxyPrefs.port));
  }, [proxyPrefs.enabled, proxyPrefs.host, proxyPrefs.port]);

  // On mount, ask main whether credentials are stored so a saved-placeholder can
  // show without ever round-tripping the password. Optional-chained because this
  // effect runs on every SettingsPage mount regardless of the active tab (the
  // preload always provides the API in the app; guards the test/SSR context).
  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.proxy
      ?.hasCredentials()
      .then((result) => {
        if (!cancelled) setProxyHasCredentials(result.hasCredentials);
      })
      .catch(() => {
        /* advisory only — fall back to the prefs hint already in state */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Validate the port field (numeric, 1–65535). Empty is allowed here — an empty
  // host already disables the proxy, so an empty port isn't an error on its own.
  const validateProxyPort = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      setProxyPortError(null);
      return true;
    }
    const port = Number(trimmed);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setProxyPortError("Port must be a number between 1 and 65535.");
      return false;
    }
    setProxyPortError(null);
    return true;
  };

  const handleProxySave = async () => {
    const host = proxyHost.trim();
    const portRaw = proxyPort.trim();
    if (!validateProxyPort(portRaw)) return;
    const port = portRaw === "" ? null : Number(portRaw);
    const config = { enabled: proxyEnabled, host, port };

    // Persist host/port/enabled (never the password). Spread-preserve so the
    // main-owned `hasCredentials` advisory field survives the write.
    await updatePreferences({ proxy: { ...proxyPrefs, ...config } });

    // Apply credential changes (write-only) before applying the proxy so a 407
    // can be answered on the first proxied request.
    if (proxyPassword !== "") {
      const result = await window.electronAPI.proxy.setCredentials({
        username: proxyUsername,
        password: proxyPassword,
      });
      setProxyHasCredentials(result.hasCredentials);
      // Clear the password field after a successful write — it's never re-shown.
      setProxyPassword("");
    }

    const applyResult = await window.electronAPI.proxy.apply(config);
    if (applyResult.error) {
      setProxyApplyError(applyResult.error);
      setProxyStatus(null);
      return;
    }
    setProxyApplyError(null);
    // Enabled with no host applied → honest "disabled" status, not "Saved".
    setProxyStatus(proxyEnabled && host === "" ? "disabled" : "saved");
    setTimeout(() => setProxyStatus(null), 4000);
  };

  const handleProxyClearCredentials = async () => {
    const result = await window.electronAPI.proxy.setCredentials(null);
    setProxyHasCredentials(result.hasCredentials);
    setProxyUsername("");
    setProxyPassword("");
  };

  return (
    <div className="flex h-full overflow-hidden bg-[var(--color-background)] text-[var(--color-foreground)]">
      {/* Sidebar Navigation */}
      <aside className="flex w-[232px] flex-shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-background-secondary)]">
        <div className="px-5 pb-2 pt-5">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <IoMdSettings
              className="h-5 w-5 text-[var(--color-foreground-secondary)]"
              aria-hidden
            />
            {translateSettings("settings.settings")}
          </h1>
          <p className="mt-1 text-xs text-[var(--color-foreground-secondary)]">
            {translateSettings("settings.personalizeYourStreamfusionExperience")}
          </p>
        </div>

        {/* Search bar — filters sidebar to tabs containing matches and hides
            non-matching rows within the active tab. */}
        <div className="px-4 pb-2 pt-3">
          <div className="relative">
            <LuSearch
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-foreground-muted)]"
              aria-hidden
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={translateSettings("settings.searchSettings")}
              aria-label={translateSettings("settings.searchSettings")}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background-tertiary)] py-2 pl-9 pr-9 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-foreground-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label={translateSettings("settings.clearSearch")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-foreground-muted)] hover:bg-[var(--color-background-elevated)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                <LuX className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <nav
          aria-label={translateSettings("settings.settingsNavigation")}
          className="flex-1 space-y-3 overflow-y-auto px-3 pb-4 pt-2"
        >
          {SETTINGS_GROUPS.map((group) => {
            const visibleTabs = group.tabs.filter(
              (tab) =>
                (!DEV_ONLY_TABS.has(tab) || isDev) &&
                (!searchMatches.active || searchMatches.tabs?.has(tab))
            );
            const [firstVisibleTab] = visibleTabs;
            if (!firstVisibleTab) return null;

            const containsActiveTab = visibleTabs.some((tab) => tab === activeTab);
            const isGroupOpen =
              searchMatches.active || containsActiveTab || visibleTabs.length === 1;
            const groupPanelId = `settings-group-${firstVisibleTab}`;

            return (
              <section
                key={group.label}
                aria-label={translateSettings("settings.valueSettings", { value1: group.label })}
                className="overflow-hidden rounded-xl border border-[#333333] bg-[#1a1a1a]"
              >
                <button
                  type="button"
                  aria-expanded={isGroupOpen}
                  aria-controls={groupPanelId}
                  aria-label={translateSettings("settings.valueSettingsSection", {
                    value1: group.label,
                  })}
                  onClick={() => {
                    if (!containsActiveTab) navigateToTab(firstVisibleTab, false, true);
                  }}
                  className={cn(
                    "flex min-h-10 w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold tracking-wide transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-ring)] motion-reduce:transition-none",
                    containsActiveTab
                      ? "bg-[#252525] text-white"
                      : "text-[#b2b2b2] hover:bg-[#252525] hover:text-white"
                  )}
                >
                  <span>{group.label}</span>
                  <LuChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                      isGroupOpen ? "rotate-0" : "-rotate-90"
                    )}
                    aria-hidden
                  />
                </button>

                {isGroupOpen && (
                  <div
                    id={groupPanelId}
                    className="space-y-1 border-t border-[#333333] bg-[#0f0f0f] p-2"
                  >
                    {visibleTabs.map((tab) => {
                      const meta = TAB_META[tab];
                      return (
                        <SidebarItem
                          key={tab}
                          tab={tab}
                          icon={meta.icon}
                          label={meta.label}
                          isActive={activeTab === tab}
                          onSelect={() => setPendingTab({ tab, from: urlActiveTab })}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}

          {!hasVisibleTabMatches && (
            <p className="px-2 py-6 text-center text-sm text-[var(--color-foreground-muted)]">
              {translateSettings("settings.noSettingsMatch")}
              {searchQuery}".
            </p>
          )}
        </nav>
      </aside>

      {/* Main Content Area */}
      <div
        ref={contentScrollerRef}
        role="region"
        aria-label={translateSettings("settings.valueSettings", {
          value1: TAB_META[activeTab].label,
        })}
        className="flex-1 overflow-y-auto bg-[var(--color-background)]"
      >
        <div
          className={cn(
            "mx-auto w-full px-6 py-8 lg:px-10 lg:py-10",
            activeTab === "diagnostics" ? "max-w-[1440px]" : "max-w-5xl"
          )}
        >
          {!canRenderSettingsPanel ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="h-8 w-44 rounded bg-[#18181b] animate-pulse" />
                <div className="h-4 w-80 rounded bg-[#18181b] animate-pulse" />
              </div>
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-24 rounded-xl border border-[#27272a] bg-[#121214] animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : searchMatches.active && !activeTabHasMatches ? (
            /* Empty state: the query matched no tabs (or the auto-jump hasn't
               landed on a matching tab yet). The sidebar shows the same kind
               of empty state in its own column. */
            <div className="flex flex-col items-center justify-center text-center py-16">
              <div className="w-12 h-12 rounded-xl bg-[#18181b] border border-[#27272a] flex items-center justify-center mb-4">
                <LuSearch className="w-5 h-5 text-zinc-500" />
              </div>
              <h2 className="text-lg font-semibold text-zinc-200 mb-1">
                {translateSettings("settings.noSettingsFound")}
              </h2>
              <p className="text-sm text-zinc-500 mb-4">
                {translateSettings("settings.nothingMatches")}
                {searchQuery}".
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-sm font-medium text-zinc-300 hover:text-white hover:underline"
              >
                {translateSettings("settings.clearSearch")}
              </button>
            </div>
          ) : (
            <>
              {activeTab === "general" && preferences && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">{t("settings.general")}</h2>
                    <p className="text-zinc-400">{t("settings.generalDescription")}</p>
                  </div>
                  <div className="rounded-xl border border-[#27272a] bg-[#121214] p-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <label
                          htmlFor="settings-display-language"
                          className="font-medium text-zinc-200"
                        >
                          {t("settings.displayLanguage")}
                        </label>
                        <p className="mt-1 text-sm text-zinc-500">
                          {t("settings.languageDescription")}
                        </p>
                      </div>
                      <DisplayLanguageSelect
                        id="settings-display-language"
                        value={resolveDisplayLanguage(preferences.language)}
                        onChange={(language) => void updatePreferences({ language })}
                      />
                    </div>
                  </div>
                </div>
              )}
              {/* Playback Tab */}
              {activeTab === "playback" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.playback")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings("settings.manageYourDefaultStreamViewingExperience")}
                    </p>
                  </div>

                  {isRowVisible("Default Quality") && (
                    <div className="p-1 rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="p-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-zinc-200">
                              {translateSettings("settings.defaultQuality")}
                            </p>
                            <p className="text-sm text-zinc-500 mt-1">
                              {translateSettings("settings.preferredStreamQualityWhenAvailable")}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Select
                              value={
                                preferences?.playback?.defaultQuality === "2k"
                                  ? "1440p"
                                  : preferences?.playback?.defaultQuality || "auto"
                              }
                              onValueChange={handleQualityChange}
                            >
                              <SelectTrigger
                                aria-label={translateSettings("settings.defaultQuality")}
                                className="w-[180px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-yellow-500/20"
                              >
                                <SelectValue
                                  placeholder={translateSettings("settings.selectQuality")}
                                />
                              </SelectTrigger>
                              <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                                <SelectItem value="auto">
                                  {translateSettings("settings.auto")}
                                </SelectItem>
                                <SelectItem value="highest">
                                  {translateSettings("settings.highest")}
                                </SelectItem>
                                <SelectItem value="1440p">
                                  {translateSettings("settings.value1440p2k")}
                                </SelectItem>
                                <SelectItem value="1080p">
                                  {translateSettings("settings.value1080p60")}
                                </SelectItem>
                                <SelectItem value="720p">
                                  {translateSettings("settings.value720p60")}
                                </SelectItem>
                                <SelectItem value="480p">
                                  {translateSettings("settings.value480p")}
                                </SelectItem>
                                <SelectItem value="360p">
                                  {translateSettings("settings.value360p")}
                                </SelectItem>
                                <SelectItem value="160p">
                                  {translateSettings("settings.value160p")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Advanced (stream token) — U13. Overrides apply ONLY via the
                  ad-block token pipeline; the resolver path keeps its defaults. */}
                  {isRowVisible("Featured carousel timing") && (
                    <div className="p-1 rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="p-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-200">
                              {translateSettings("settings.featuredCarouselTiming")}
                            </p>
                            <p className="text-sm text-zinc-500 mt-1">
                              {translateSettings(
                                "settings.howLongEachHomePageFeaturedStreamStaysActiveBeforeRotatingCurren"
                              )}
                              {formatCarouselIntervalLabel(homeCarouselIntervalSeconds)}.
                            </p>
                          </div>

                          <div className="flex w-full items-center gap-3 sm:w-[360px]">
                            <input
                              type="range"
                              aria-label={translateSettings("settings.featuredCarouselTiming")}
                              min={homeCarouselIntervalMinSeconds}
                              max={homeCarouselIntervalMaxSeconds}
                              step={HOME_CAROUSEL_INTERVAL_STEP_SECONDS}
                              value={homeCarouselIntervalSeconds}
                              onChange={(e) =>
                                handleHomeCarouselIntervalChange(Number(e.target.value))
                              }
                              className="h-2 min-w-0 flex-1 cursor-pointer accent-zinc-200"
                            />
                            <div className="flex shrink-0 items-center rounded-lg border border-[#27272a] bg-[#18181b] pr-2 text-sm text-zinc-500">
                              <input
                                type="number"
                                aria-label={translateSettings(
                                  "settings.featuredCarouselTimingSeconds"
                                )}
                                min={homeCarouselIntervalMinSeconds}
                                max={homeCarouselIntervalMaxSeconds}
                                step={HOME_CAROUSEL_INTERVAL_STEP_SECONDS}
                                value={homeCarouselIntervalSeconds}
                                onChange={(e) =>
                                  handleHomeCarouselIntervalChange(Number(e.target.value))
                                }
                                className="h-9 w-16 rounded-l-lg bg-transparent px-2 text-right text-zinc-200 outline-none"
                              />
                              {translateSettings("settings.sec")}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {anyRowVisible(
                    "Access-token player type",
                    "Allow HEVC (H.265)",
                    "Stream device ID"
                  ) && (
                    <div className="rounded-xl border border-amber-500/20 bg-[#121214] overflow-hidden">
                      <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                          {translateSettings("settings.advancedStreamToken")}
                        </h3>
                      </div>

                      {/* Persistent danger banner */}
                      <div className="mx-6 mt-4 flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300/90">
                        <LuTriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <p className="text-sm leading-relaxed">
                          {translateSettings(
                            "settings.theseAffectHowTheTwitchStreamTokenIsRequestedWrongValuesCanBreak"
                          )}
                        </p>
                      </div>

                      <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                        {/* Player type */}
                        {isRowVisible("Access-token player type") && (
                          <div className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-zinc-200">
                                {translateSettings("settings.accessTokenPlayerType")}
                              </p>
                              <p className="text-sm text-zinc-500 mt-0.5">
                                {translateSettings(
                                  "settings.playerTypeUsedWhenRequestingTheAdBlockStreamTokenLeaveOnDefaultU"
                                )}
                              </p>
                            </div>
                            <Select
                              value={playbackAdvanced.playerType}
                              onValueChange={(v) =>
                                handlePlaybackAdvancedChange(
                                  "playerType",
                                  v as PlaybackAdvancedPlayerType
                                )
                              }
                            >
                              <SelectTrigger
                                aria-label={translateSettings("settings.accessTokenPlayerType")}
                                className="w-[200px] flex-shrink-0 bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-amber-500/20"
                              >
                                <SelectValue
                                  placeholder={translateSettings("settings.selectPlayerType")}
                                />
                              </SelectTrigger>
                              <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                                {PLAYBACK_ADVANCED_PLAYER_TYPES.map(({ value, label }) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Allow HEVC */}
                        {isRowVisible("Allow HEVC (H.265)") && (
                          <div className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-zinc-200">
                                {translateSettings("settings.allowHevcH265")}
                              </p>
                              <p className="text-sm text-zinc-500 mt-0.5">
                                {translateSettings(
                                  "settings.keepHevcStreamsInsteadOfSwappingToAvcDuringAdsOffByDefaultEnabli"
                                )}
                              </p>
                            </div>
                            <Switch
                              checked={playbackAdvanced.allowHevc}
                              onCheckedChange={(v) => handlePlaybackAdvancedChange("allowHevc", v)}
                              aria-label={translateSettings("settings.allowHevc")}
                            />
                          </div>
                        )}

                        {/* Device-id randomize */}
                        {isRowVisible("Stream device ID") && (
                          <div className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-zinc-200">
                                {translateSettings("settings.streamDeviceId")}
                              </p>
                              <p className="text-sm text-zinc-500 mt-0.5">
                                {translateSettings(
                                  "settings.identifierSentWithTheAdBlockStreamToken2"
                                )}{" "}
                                {adBlockDeviceId ? (
                                  <>
                                    {translateSettings("settings.current")}{" "}
                                    <code className="text-zinc-400">
                                      {adBlockDeviceId.slice(0, 8)}…
                                    </code>
                                  </>
                                ) : (
                                  translateSettings("settings.notYetGeneratedSetOnFirstStreamLoad")
                                )}{" "}
                                {translateSettings(
                                  "settings.randomizingTakesEffectOnTheNextStreamLoad"
                                )}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleRandomizeDeviceId}
                              className="flex-shrink-0 bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
                            >
                              {translateSettings("settings.randomize")}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notifications Tab */}
              {activeTab === "notifications" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.notifications")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.controlLiveStreamAlertsDesktopNoticesRestartCooldownsAndFollowed"
                      )}
                    </p>
                  </div>

                  {(() => {
                    const visibleToggles = NOTIFICATION_TOGGLES.filter(({ label }) =>
                      isRowVisible(label)
                    );
                    const showRestartGrace = isRowVisible("Restart grace");
                    if (!visibleToggles.length && !showRestartGrace) return null;

                    return (
                      <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
                          <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                            {translateSettings("settings.liveNotificationPreferences")}
                          </h3>
                        </div>

                        <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                          {visibleToggles.map(({ field, label, description }) => (
                            <div
                              key={field}
                              className="flex items-center justify-between gap-4 py-3"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-zinc-200">{label}</p>
                                <p className="text-sm text-zinc-500 mt-0.5">{description}</p>
                              </div>
                              <Switch
                                checked={Boolean(notifications[field])}
                                onCheckedChange={(v) => handleNotificationChange(field, v)}
                              />
                            </div>
                          ))}

                          {showRestartGrace && (
                            <div className="flex items-center justify-between gap-4 py-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-zinc-200">
                                  {translateSettings("settings.restartGrace")}
                                </p>
                                <p className="text-sm text-zinc-500 mt-0.5">
                                  {translateSettings(
                                    "settings.suppressRepeatAlertsWhenAStreamRestartsInsideTheSelectedCooldown"
                                  )}
                                </p>
                              </div>
                              <Select
                                value={String(notifications.restartGracePeriodMinutes)}
                                onValueChange={(value) =>
                                  handleNotificationChange(
                                    "restartGracePeriodMinutes",
                                    Number(
                                      value
                                    ) as NotificationPreferences["restartGracePeriodMinutes"]
                                  )
                                }
                              >
                                <SelectTrigger
                                  aria-label={translateSettings("settings.restartGrace")}
                                  className="w-[180px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-zinc-500/30"
                                >
                                  <SelectValue
                                    placeholder={translateSettings("settings.restartGrace")}
                                  />
                                </SelectTrigger>
                                <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                                  {RESTART_GRACE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={String(option.value)}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {isRowVisible("Per-channel notifications") && (
                    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
                        <div>
                          <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                            {translateSettings("settings.followedChannels")}
                          </h3>
                          <p className="text-sm text-zinc-500 mt-1">
                            {translateSettings(
                              "settings.newFollowsAreEnabledByDefaultFavoritesOnlyUsesTheseSwitchesToDec"
                            )}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-expanded={followedChannelNotificationsExpanded}
                          aria-label={
                            followedChannelNotificationsExpanded
                              ? translateSettings("settings.hideFollowedChannels")
                              : translateSettings("settings.showFollowedChannels")
                          }
                          onClick={() =>
                            setFollowedChannelNotificationsExpanded((expanded) => !expanded)
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#27272a] bg-[#18181b] text-zinc-400 transition-colors hover:bg-[#27272a] hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500/30"
                        >
                          <LuChevronDown
                            className={cn(
                              "h-4 w-4 transition-transform duration-200",
                              !followedChannelNotificationsExpanded && "-rotate-90"
                            )}
                            aria-hidden
                          />
                        </button>
                      </div>

                      {followedChannelNotificationsExpanded && (
                        <>
                          {followedChannels.length > 0 && (
                            <div className="border-b border-[#27272a] px-6 py-4">
                              <div className="relative">
                                <LuSearch
                                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
                                  aria-hidden
                                />
                                <input
                                  type="text"
                                  value={followedChannelSearch}
                                  onChange={(e) => setFollowedChannelSearch(e.target.value)}
                                  placeholder={translateSettings("settings.searchFollowedChannels")}
                                  aria-label={translateSettings("settings.searchFollowedChannels")}
                                  autoComplete="off"
                                  spellCheck={false}
                                  className="w-full rounded-lg border border-[#27272a] bg-[#18181b] py-2 pl-9 pr-9 text-sm text-zinc-200 placeholder:text-zinc-500 focus:border-zinc-500/40 focus:outline-none focus:ring-2 focus:ring-zinc-500/30"
                                />
                                {followedChannelSearch && (
                                  <button
                                    type="button"
                                    onClick={() => setFollowedChannelSearch("")}
                                    aria-label={translateSettings(
                                      "settings.clearFollowedChannelSearch"
                                    )}
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:bg-[#27272a] hover:text-zinc-200"
                                  >
                                    <LuX className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {followedChannels.length === 0 ? (
                            <div className="px-6 py-8 text-sm text-zinc-500">
                              {translateSettings("settings.noFollowedChannelsYet")}
                            </div>
                          ) : filteredFollowedChannels.length === 0 ? (
                            <div className="px-6 py-8 text-sm text-zinc-500">
                              {translateSettings("settings.noFollowedChannelsMatch")}
                              {followedChannelSearch}".
                            </div>
                          ) : (
                            <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                              {filteredFollowedChannels.map((channel) => (
                                <div
                                  key={`${channel.platform}:${channel.id || channel.username}`}
                                  className="flex items-center justify-between gap-4 py-3"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-zinc-200 truncate">
                                      {channel.displayName || channel.username}
                                    </p>
                                    <p className="text-sm text-zinc-500 mt-0.5 capitalize">
                                      {channel.platform}
                                    </p>
                                  </div>
                                  <Switch
                                    aria-label={translateSettings(
                                      "settings.notificationsForValue",
                                      { value1: channel.displayName || channel.username }
                                    )}
                                    checked={isPerChannelNotificationEnabled(
                                      notifications,
                                      channel
                                    )}
                                    onCheckedChange={(value) =>
                                      handlePerChannelNotificationChange(channel, value)
                                    }
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {isRowVisible("Notification coverage") && (
                    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="px-6 py-4 border-b border-[#27272a]">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                          {translateSettings("settings.notificationCoverage")}
                        </h3>
                      </div>
                      <div className="px-6 py-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-[#27272a] bg-[#18181b] p-4">
                          <p className="text-sm font-medium text-zinc-200">
                            {translateSettings("settings.desktopNotificationSupport")}
                          </p>
                          <p className="text-sm text-zinc-500 mt-1">
                            {formatDesktopNotificationStatus(
                              notificationCoverage?.desktop.supported ??
                                desktopNotificationsSupported,
                              desktopNotificationPermission
                            )}
                          </p>
                        </div>
                        {(["twitch", "kick"] as const).map((platform) => {
                          const platformCoverage = notificationCoverage?.platforms[platform];
                          const isDegraded = platformCoverage?.status === "degraded";
                          const statusLabel = platformCoverage
                            ? isDegraded
                              ? translateSettings("settings.degraded")
                              : translateSettings("settings.normal")
                            : translateSettings("settings.statusUnavailable");
                          return (
                            <div
                              key={platform}
                              className="rounded-lg border border-[#27272a] bg-[#18181b] p-4"
                            >
                              <p className="text-sm font-medium text-zinc-200">
                                {translateSettings("settings.platformCoverageStatus", {
                                  platform: formatPlatformLabel(platform),
                                  status: statusLabel,
                                })}
                              </p>
                              {platformCoverage?.issues.length ? (
                                <div className="mt-2 space-y-1">
                                  {platformCoverage.issues.map((issue) => (
                                    <p
                                      key={`${issue.platform}:${issue.reason}`}
                                      className="text-sm text-zinc-500"
                                    >
                                      {issue.message}
                                    </p>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-sm text-zinc-500 mt-1">
                                  {translateSettings(
                                    "settings.liveNotificationsAreMonitoringNormally"
                                  )}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Player Controls Tab */}
              {activeTab === "player-controls" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.playerControls")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.chooseWhichButtonsAppearInThePlayerHidingAControlOnlyRemovesItsB"
                      )}
                    </p>
                  </div>

                  {(() => {
                    const visibleToggles = PLAYER_CONTROL_TOGGLES.filter(({ label }) =>
                      isRowVisible(label)
                    );
                    if (visibleToggles.length === 0) return null;
                    return (
                      <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
                          <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                            {translateSettings("settings.visibleControls")}
                          </h3>
                        </div>
                        <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                          {visibleToggles.map(({ field, label, description }) => (
                            <div
                              key={field}
                              className="flex items-center justify-between gap-4 py-3"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-zinc-200">{label}</p>
                                {description && (
                                  <p className="text-sm text-zinc-500 mt-0.5">{description}</p>
                                )}
                              </div>
                              <Switch
                                checked={playerControls[field]}
                                onCheckedChange={(v) => handlePlayerControlToggle(field, v)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {anyRowVisible("Rewind", "Fast forward") && (
                    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)]">
                      <div className="border-b border-[var(--color-border)] px-6 py-4">
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-foreground-muted)]">
                          {translateSettings("settings.seekIntervals")}
                        </h3>
                        <p className="mt-1 text-xs text-[var(--color-foreground-secondary)]">
                          {translateSettings(
                            "settings.seekIntervalsApplyToVodsAndClipsLiveStreamsAreUnaffected"
                          )}
                        </p>
                      </div>
                      <div className="divide-y divide-[var(--color-border)] px-6 py-2">
                        {isRowVisible("Rewind") && (
                          <div className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0 flex-1">
                              <label
                                className="font-medium text-[var(--color-foreground)]"
                                htmlFor="rewind-seconds"
                              >
                                {translateSettings("settings.rewind")}
                              </label>
                              <p
                                className="mt-0.5 text-sm text-[var(--color-foreground-muted)]"
                                id="rewind-seconds-description"
                              >
                                {translateSettings("settings.secondsSkippedBackwardInVodsAndClips")}
                              </p>
                            </div>
                            <SeekIntervalSelect
                              descriptionId="rewind-seconds-description"
                              id="rewind-seconds"
                              value={rewindSeconds}
                              onChange={(seconds) => {
                                setRewindSeconds(seconds);
                                notifySettingsSaved();
                              }}
                            />
                          </div>
                        )}

                        {isRowVisible("Fast forward") && (
                          <div className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0 flex-1">
                              <label
                                className="font-medium text-[var(--color-foreground)]"
                                htmlFor="fast-forward-seconds"
                              >
                                {translateSettings("settings.fastForward")}
                              </label>
                              <p
                                className="mt-0.5 text-sm text-[var(--color-foreground-muted)]"
                                id="fast-forward-seconds-description"
                              >
                                {translateSettings("settings.secondsSkippedForwardInVodsAndClips")}
                              </p>
                            </div>
                            <SeekIntervalSelect
                              descriptionId="fast-forward-seconds-description"
                              id="fast-forward-seconds"
                              value={forwardSeconds}
                              onChange={(seconds) => {
                                setForwardSeconds(seconds);
                                notifySettingsSaved();
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Buffer Tab */}
              {activeTab === "buffer" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.buffer")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.tuneTheLatencyVsStabilityTradeoffForLiveStreamsTwitchKickTheseAp"
                      )}
                    </p>
                  </div>

                  {(() => {
                    const showLowLatency = isRowVisible("Low-latency mode");
                    const visibleRanges = BUFFER_RANGE_CONTROLS.filter(({ label }) =>
                      isRowVisible(label)
                    );
                    if (!showLowLatency && visibleRanges.length === 0) return null;
                    return (
                      <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
                          <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                            {translateSettings("settings.liveBuffer")}
                          </h3>
                          <div className="flex items-center gap-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleBufferReset}
                              className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
                            >
                              {translateSettings("settings.resetToDefaults")}
                            </Button>
                          </div>
                        </div>

                        <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                          {/* Low-latency mode switch */}
                          {showLowLatency && (
                            <div className="flex items-center justify-between gap-4 py-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-zinc-200">
                                  {translateSettings("settings.lowLatencyMode")}
                                </p>
                                <p className="text-sm text-zinc-500 mt-0.5">
                                  {translateSettings(
                                    "settings.trackTheLiveEdgeAggressivelyDisableForSteadierPlaybackOnFlakyCon"
                                  )}
                                </p>
                              </div>
                              <Switch
                                checked={buffer.lowLatencyMode}
                                onCheckedChange={(v) => handleBufferChange("lowLatencyMode", v)}
                              />
                            </div>
                          )}

                          {/* Numeric range controls */}
                          {visibleRanges.map(
                            ({ field, label, description, min, max, step, unit }) => (
                              <div
                                key={field}
                                className="flex items-center justify-between gap-4 py-3"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-zinc-200">{label}</p>
                                  <p className="text-sm text-zinc-500 mt-0.5">{description}</p>
                                </div>
                                <div className="flex items-center gap-3 flex-shrink-0">
                                  <input
                                    type="range"
                                    min={min}
                                    max={max}
                                    step={step}
                                    value={buffer[field]}
                                    onChange={(e) =>
                                      handleBufferChange(field, Number.parseFloat(e.target.value))
                                    }
                                    className="w-40 accent-yellow-500"
                                    aria-label={label}
                                  />
                                  <span className="w-16 text-right text-sm tabular-nums text-zinc-300">
                                    {buffer[field]} {unit}
                                  </span>
                                </div>
                              </div>
                            )
                          )}
                        </div>

                        <div className="px-6 py-3 border-t border-[#27272a] text-xs text-zinc-500">
                          {translateSettings("settings.changesApplyWhenTheStreamNextLoads")}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Multiview keeps layout membership separate from concurrent playback cost. */}
              {activeTab === "multiview" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.multiview")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.keepAnyNumberOfChannelsInYourLayoutChooseHowManyPlayAtOnceAndCon"
                      )}
                    </p>
                  </div>

                  {isRowVisible("Concurrent playback budget") && (
                    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                          {translateSettings("settings.playbackBudget")}
                        </h3>
                      </div>

                      <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                        <div className="flex items-center justify-between gap-4 py-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-zinc-200">
                              {translateSettings("settings.concurrentPlaybackBudget")}
                            </p>
                            <p className="text-sm text-zinc-500 mt-0.5 leading-relaxed">
                              {translateSettings(
                                "settings.addAsManyChannelsAsYouNeedThisBudgetControlsHowManyVideoDecoders"
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <input
                              type="number"
                              min={MULTIVIEW_PLAYBACK_BUDGET_MIN}
                              step={1}
                              value={playbackBudget}
                              onChange={(e) =>
                                handlePlaybackBudgetChange(Number.parseInt(e.target.value, 10))
                              }
                              className="w-24 rounded-md border border-[#27272a] bg-[#1a1a1a] px-3 py-2 text-right text-zinc-200"
                              aria-label={translateSettings("settings.concurrentPlaybackBudget")}
                            />
                            <span className="w-16 text-right text-sm tabular-nums text-zinc-200">
                              {playbackBudget}{" "}
                              {playbackBudget === 1
                                ? translateSettings("settings.stream")
                                : translateSettings("settings.streams")}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="px-6 py-3 border-t border-[#27272a] text-xs text-zinc-500">
                        {translateSettings("settings.minimum")}
                        {MULTIVIEW_PLAYBACK_BUDGET_MIN}
                        {translateSettings("settings.defaultIs4ThereIsNoHardMaximum")}
                      </div>
                    </div>
                  )}

                  {/* Background-stream quality (slice 08 of PRD #51 / issue #59).
                      Controls how non-focused slots render: full quality keeps
                      the RAM cost high; auto-low is the default RAM-friendly
                      clamp; off disables video on backgrounds entirely. */}
                  {isRowVisible("Background-stream quality") && (
                    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                          {translateSettings("settings.backgroundStreams")}
                        </h3>
                      </div>

                      <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                        <div className="flex items-center justify-between gap-4 py-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-zinc-200">
                              {translateSettings("settings.backgroundStreamQuality")}
                            </p>
                            <p className="text-sm text-zinc-500 mt-0.5 leading-relaxed">
                              {translateSettings(
                                "settings.howNonFocusedStreamsRenderLowerSettingsFreeUpRamAndBandwidthSoTh"
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <Select
                              value={backgroundQuality}
                              onValueChange={(v) =>
                                handleBackgroundQualityChange(v as BackgroundQuality)
                              }
                            >
                              <SelectTrigger
                                aria-label={translateSettings("settings.backgroundStreamQuality")}
                                className="w-[200px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-zinc-500/30"
                              >
                                <SelectValue
                                  placeholder={translateSettings("settings.selectQuality")}
                                />
                              </SelectTrigger>
                              <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                                <SelectItem value="auto-low">
                                  {translateSettings("settings.autoLow480pRecommended")}
                                </SelectItem>
                                <SelectItem value="match-source">
                                  {translateSettings("settings.matchSourceUsesMoreRam")}
                                </SelectItem>
                                <SelectItem value="off">
                                  {translateSettings("settings.offAudioOnly")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      <div className="px-6 py-3 border-t border-[#27272a] text-xs text-zinc-500">
                        {translateSettings("settings.defaultAutoLow")}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Chat Tab */}
              {activeTab === "chat" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.chat")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.appearanceEmotesEventsAndBehaviorForTheUnifiedTwitchKickChat"
                      )}
                    </p>
                  </div>

                  <ChatSettingsSection />
                </div>
              )}

              {/* Ad-Block Tab */}
              {activeTab === "adblock" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.adBlock")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings("settings.manageAdBlockingCapabilitiesForTwitchStreams")}
                    </p>
                  </div>

                  {isRowVisible("Enable Ad-Blocking") && (
                    <div className="p-6 rounded-xl border border-[#27272a] bg-[#121214]">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 rounded-lg bg-green-500/10 text-green-400">
                          <LuShieldCheck className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">
                            {translateSettings("settings.clientSideAdBlocking")}
                          </h3>
                          <p className="text-sm text-zinc-500">
                            {translateSettings("settings.bypassTwitchAdvertisementsLocally")}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-lg bg-[#18181b]/50 border border-[#27272a]">
                        <div>
                          <p className="font-medium text-zinc-200">
                            {translateSettings("settings.enableAdBlocking")}
                          </p>
                          <p className="text-sm text-zinc-500 mt-1">
                            {translateSettings(
                              "settings.blockTwitchAdsUsingAlternativePlayerTokens"
                            )}
                          </p>
                        </div>
                        <Switch
                          checked={isPlaylistProxyEnabled ? false : enableAdBlock}
                          onCheckedChange={setEnableAdBlock}
                          disabled={isPlaylistProxyEnabled}
                          className="data-[state=checked]:!bg-green-500 data-[state=checked]:!border-green-500"
                          thumbClassName="data-[state=checked]:!bg-white"
                        />
                      </div>
                      {isPlaylistProxyEnabled && (
                        <p className="mt-4 text-sm text-zinc-400">
                          {translateSettings(
                            "settings.twitchPlaylistProxyIsEnabledSoTheCustomAdBlockerIsPausedYourSave"
                          )}
                        </p>
                      )}
                      <div className="mt-4 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10 text-sm text-blue-300/80 leading-relaxed">
                        {translateSettings(
                          "settings.thisUsesTheVaftTechniqueToRequestAdFreeStreamsViaBackupPlayerTyp"
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Proxy Tab (U12 — drives the U11 main-process proxy) */}
              {activeTab === "proxy" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.proxy")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.usePlaylistProxiesForTwitchPlaybackOrConfigureTheDefaultSessionT"
                      )}
                    </p>
                  </div>

                  <TwitchPlaylistProxySettingsSection />

                  {isRowVisible("Network library") && (
                    <div className="rounded-xl border border-[#333333] bg-[#1a1a1a] p-6">
                      <div className="flex items-start justify-between gap-6">
                        <div>
                          <p className="font-medium text-zinc-200">
                            {translateSettings("settings.networkLibrary")}
                          </p>
                          <p className="mt-1 text-sm text-zinc-400">
                            {translateSettings(
                              "settings.sharedMainProcessHttpAndRendererMediaUseChromiumInterceptorOwned"
                            )}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-md border border-[#333333] bg-[#252525] px-3 py-1.5 text-sm font-medium text-zinc-300">
                          {translateSettings("settings.chromiumBuiltIn")}
                        </span>
                      </div>
                    </div>
                  )}

                  {anyRowVisible("Enable proxy", "Host", "Port", "Credentials") && (
                    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="p-6 border-b border-[#27272a]">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
                            <LuNetwork className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-lg">
                              {translateSettings("settings.advancedTransportProxy")}
                            </h3>
                            <p className="text-sm text-zinc-500">
                              {translateSettings(
                                "settings.appliedToChromiumRequestsInElectronAposSDefaultSession"
                              )}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="p-6 space-y-6">
                        {/* Enable switch */}
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-zinc-200">
                              {translateSettings("settings.enableProxy")}
                            </p>
                            <p className="text-sm text-zinc-500 mt-1">
                              {translateSettings(
                                "settings.offByDefaultRoutesDefaultSessionChromiumRequestsThroughTheHostBe"
                              )}
                            </p>
                          </div>
                          <Switch
                            checked={proxyEnabled}
                            onCheckedChange={setProxyEnabled}
                            aria-label={translateSettings("settings.enableProxy")}
                            className="data-[state=checked]:!bg-sky-500 data-[state=checked]:!border-sky-500"
                            thumbClassName="data-[state=checked]:!bg-white"
                          />
                        </div>

                        {/* Host */}
                        <div className="space-y-2">
                          <label htmlFor="proxy-host" className="block font-medium text-zinc-200">
                            {translateSettings("settings.host")}
                          </label>
                          <input
                            id="proxy-host"
                            type="text"
                            value={proxyHost}
                            onChange={(e) => setProxyHost(e.target.value)}
                            placeholder="127.0.0.1"
                            autoComplete="off"
                            spellCheck={false}
                            className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500/40"
                          />
                          <p className="text-xs text-zinc-500">
                            {translateSettings("settings.hostOrIpOnlyNoSchemeEG")}
                            <code>127.0.0.1</code>
                            {translateSettings("settings.not")} <code>http://…</code>).
                          </p>
                        </div>

                        {/* Port */}
                        <div className="space-y-2">
                          <label htmlFor="proxy-port" className="block font-medium text-zinc-200">
                            {translateSettings("settings.port")}
                          </label>
                          <input
                            id="proxy-port"
                            type="text"
                            inputMode="numeric"
                            value={proxyPort}
                            onChange={(e) => {
                              // Numbers only as the user types.
                              setProxyPort(e.target.value.replace(/[^0-9]/g, ""));
                              if (proxyPortError) setProxyPortError(null);
                            }}
                            onBlur={(e) => validateProxyPort(e.target.value)}
                            placeholder="8080"
                            autoComplete="off"
                            aria-invalid={proxyPortError ? true : undefined}
                            className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500/40"
                          />
                          {proxyPortError ? (
                            <p className="text-xs text-red-400">{proxyPortError}</p>
                          ) : (
                            <p className="text-xs text-zinc-500">
                              {translateSettings("settings.aNumberBetween1And65535")}
                            </p>
                          )}
                        </div>

                        {/* Credentials */}
                        <div className="pt-6 border-t border-[#27272a] space-y-4">
                          <div>
                            <p className="font-medium text-zinc-200">
                              {translateSettings("settings.credentialsOptional")}
                            </p>
                            <p className="text-sm text-zinc-500 mt-1">
                              {translateSettings(
                                "settings.forAProxyThatRequiresAuthenticationStoredEncryptedOnThisDeviceAn"
                              )}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <label htmlFor="proxy-username" className="block text-sm text-zinc-400">
                              {translateSettings("settings.username")}
                            </label>
                            <input
                              id="proxy-username"
                              type="text"
                              value={proxyUsername}
                              onChange={(e) => setProxyUsername(e.target.value)}
                              autoComplete="off"
                              spellCheck={false}
                              className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500/40"
                            />
                          </div>

                          <div className="space-y-2">
                            <label htmlFor="proxy-password" className="block text-sm text-zinc-400">
                              {translateSettings("settings.password")}
                            </label>
                            <div className="relative">
                              <input
                                id="proxy-password"
                                type={showProxyPassword ? "text" : "password"}
                                value={proxyPassword}
                                onChange={(e) => setProxyPassword(e.target.value)}
                                placeholder={
                                  proxyHasCredentials && proxyPassword === ""
                                    ? translateSettings("settings.saved")
                                    : undefined
                                }
                                autoComplete="new-password"
                                className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2 pr-10 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500/40"
                              />
                              <button
                                type="button"
                                onClick={() => setShowProxyPassword((v) => !v)}
                                aria-label={
                                  showProxyPassword
                                    ? translateSettings("settings.hidePassword")
                                    : translateSettings("settings.showPassword")
                                }
                                className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 hover:text-zinc-300"
                              >
                                {showProxyPassword ? (
                                  <LuEyeOff className="w-4 h-4" />
                                ) : (
                                  <LuEye className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                            {proxyHasCredentials && (
                              <button
                                type="button"
                                onClick={handleProxyClearCredentials}
                                className="text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:underline"
                              >
                                {translateSettings("settings.clearCredentials")}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Apply-failure banner (persistent, not a toast) */}
                        {proxyApplyError && (
                          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                            <LuTriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm font-medium">
                                {translateSettings("settings.couldnTApplyTheProxy")}
                              </p>
                              <p className="text-sm mt-0.5 opacity-80">{proxyApplyError}</p>
                            </div>
                          </div>
                        )}

                        {/* Save row + status */}
                        <div className="flex items-center justify-between gap-4 pt-6 border-t border-[#27272a]">
                          <div className="min-h-[1.25rem]">
                            {proxyStatus === "saved" && (
                              <span className="text-sm text-yellow-500 font-medium animate-in fade-in slide-in-from-left-2 duration-300">
                                {translateSettings("settings.saved2")}
                              </span>
                            )}
                            {proxyStatus === "disabled" && (
                              <span className="text-sm text-zinc-500 font-medium">
                                {translateSettings("settings.proxyDisabledNoHostSet")}
                              </span>
                            )}
                          </div>
                          <Button
                            onClick={handleProxySave}
                            className="bg-sky-500 hover:bg-sky-400 text-white"
                          >
                            {translateSettings("settings.saveApply")}
                          </Button>
                        </div>
                      </div>

                      <div className="px-6 py-4 border-t border-[#27272a] text-xs text-zinc-500 leading-relaxed">
                        {translateSettings(
                          "settings.whenEnabledThisProxyAppliesToChromiumRequestsInElectronAposSDefa"
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Predictions Tab */}
              {activeTab === "predictions" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.predictions")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.visualStyleForTheChatPredictionWidgetWhenAStreamerRunsAPredictio"
                      )}
                    </p>
                  </div>

                  {isRowVisible("Style") && (
                    <div className="p-1 rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="max-w-md">
                            <p className="font-medium text-zinc-200">
                              {translateSettings("settings.style")}
                            </p>
                            <p className="text-sm text-zinc-500 mt-1">
                              {translateSettings(
                                "settings.nativeMatchesEachPlatformSOwnUiTwitchPurpleWithBubbleChartKickGr"
                              )}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Select
                              value={preferences?.predictions?.style ?? "native"}
                              onValueChange={handlePredictionStyleChange}
                            >
                              <SelectTrigger className="w-[200px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-yellow-500/20">
                                <SelectValue
                                  placeholder={translateSettings("settings.selectStyle")}
                                />
                              </SelectTrigger>
                              <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                                <SelectItem value="native">
                                  {translateSettings("settings.nativePerPlatform")}
                                </SelectItem>
                                <SelectItem value="unified">
                                  {translateSettings("settings.unifiedStreamfusion")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Integrations Tab */}
              {activeTab === "integrations" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.integrations")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings("settings.manageYourConnectedAccountsAndServices")}
                    </p>
                  </div>

                  {/* Auth Error Alert (Moved here) */}
                  {error && (
                    <div
                      className={`flex items-start gap-4 p-4 rounded-xl border mb-6 ${
                        error.platform === "twitch"
                          ? "bg-[#9146FF]/5 border-[#9146FF]/20"
                          : error.platform === "kick"
                            ? "bg-[#53FC18]/5 border-[#53FC18]/20"
                            : "bg-red-500/5 border-red-500/20"
                      }`}
                    >
                      <LuCircleAlert
                        size={20}
                        className={cn(
                          "flex-shrink-0 mt-0.5",
                          error.platform === "twitch"
                            ? "text-[#9146FF]"
                            : error.platform === "kick"
                              ? "text-[#53FC18]"
                              : "text-red-400"
                        )}
                      />
                      <div className="flex-1">
                        <p className="font-medium text-white">
                          {error.platform === "twitch"
                            ? translateSettings("settings.twitchConnectionError")
                            : error.platform === "kick"
                              ? translateSettings("settings.kickConnectionError")
                              : translateSettings("settings.authenticationError")}
                        </p>
                        <p className="text-sm mt-1 text-white leading-relaxed">{error.message}</p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={clearError}
                        className="h-auto min-h-10 shrink-0 cursor-pointer border border-zinc-600 bg-zinc-800 px-3 py-2 text-white shadow-sm hover:bg-zinc-700 hover:text-white focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#121214] active:bg-zinc-900 disabled:cursor-not-allowed"
                      >
                        {translateSettings("settings.dismiss")}
                      </Button>
                    </div>
                  )}

                  {isRowVisible("Connected Accounts") && (
                    <div className="p-6 rounded-xl border border-[#27272a] bg-[#121214]">
                      <h3 className="font-semibold text-lg mb-4">
                        {translateSettings("settings.connectedAccounts")}
                      </h3>
                      <AccountConnect />
                    </div>
                  )}
                </div>
              )}

              {/* API / Tokens Tab (U14 — read-only token status) */}
              {activeTab === "api-tokens" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.apiTokens")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.readOnlyStatusOfYourTwitchAndKickSignInTokenValuesNeverLeaveYour"
                      )}
                    </p>
                  </div>

                  {isRowVisible("Token Status") && (
                    <>
                      <ApiTokenPanel
                        platform="twitch"
                        label="Twitch"
                        onOpenIntegrations={() => navigateToTab("integrations", false, true)}
                      />
                      <ApiTokenPanel
                        platform="kick"
                        label="Kick"
                        onOpenIntegrations={() => navigateToTab("integrations", false, true)}
                      />
                    </>
                  )}
                </div>
              )}

              {/* Updates Tab */}
              {activeTab === "updates" && (
                <UpdatesSettingsPanel
                  appVersion={appVersion}
                  anyRowVisible={anyRowVisible}
                  isRowVisible={isRowVisible}
                />
              )}

              {activeTab === "diagnostics" && (
                <Suspense
                  fallback={
                    <div
                      className="space-y-4"
                      aria-label={translateSettings("settings.loadingDiagnostics")}
                    >
                      <div className="h-20 animate-pulse rounded-xl bg-[var(--color-background-secondary)]" />
                      <div className="h-72 animate-pulse rounded-xl border border-[var(--color-border)] bg-[var(--color-background-secondary)]" />
                    </div>
                  }
                >
                  <DiagnosticsWorkspace onSectionChange={resetContentScroll} />
                </Suspense>
              )}

              {/* Logs Tab — dev-only. The sidebar item is hidden in prod and a
              deep-link `?tab=logs` is redirected away above, but this guard
              keeps the panel itself off in case `activeTab` lags behind. */}
              {isDev && activeTab === "logs" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.logs")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.inspectTheInAppLogFilesUsefulForDebuggingPlaybackChatAndAuthIssu"
                      )}
                    </p>
                  </div>

                  {isRowVisible("Logs") && <LogsSection />}
                </div>
              )}

              {/* Report Bug Tab — dev-only (gated by DEV_ONLY_TABS). */}
              {isDev && activeTab === "report-bug" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.reportABug")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings(
                        "settings.generateABugReportFileYouCanShareWithSomeoneDebuggingTheIssue"
                      )}
                    </p>
                  </div>

                  {isRowVisible("Report a Bug") && <BugReportSection />}
                </div>
              )}

              {/* About Tab */}
              {activeTab === "about" && (
                <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">
                      {translateSettings("settings.about")}
                    </h2>
                    <p className="text-zinc-400">
                      {translateSettings("settings.applicationInformation")}
                    </p>
                  </div>

                  {isRowVisible("About") && (
                    <div className="p-8 rounded-xl border border-[#27272a] bg-[#121214] flex flex-col items-center text-center space-y-4">
                      <img
                        src={streamFusionLogo}
                        alt=""
                        className="h-16 w-16 rounded-xl object-contain"
                      />
                      <div>
                        <h3 className="text-xl font-bold text-white">StreamFusion</h3>
                        <div className="flex items-center justify-center gap-2 mt-1">
                          <p className="text-zinc-500">
                            {translateSettings("settings.v")}
                            {versionInfo?.version ?? appVersion ?? "0.1.0"}
                          </p>
                          {versionInfo?.isPrerelease && (
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                              {translateSettings("settings.preRelease")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="pt-6 text-sm text-zinc-500">
                        <p>{translateSettings("settings.builtWithElectronReactTailwindcss")}</p>
                        <p className="mt-1">
                          {translateSettings("settings.designedForTheBestStreamingExperience")}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UpdatesSettingsPanel({
  appVersion,
  anyRowVisible,
  isRowVisible,
}: {
  appVersion: string | null | undefined;
  anyRowVisible: (...labels: string[]) => boolean;
  isRowVisible: (label: string) => boolean;
}) {
  const {
    status,
    updateInfo,
    progress,
    error: updateError,
    allowPrerelease,
    autoCheckEnabled,
    checkFrequency,
    updateCheckUrl,
    isChecking,
    isDownloading,
    isUpdateAvailable,
    isUpdateDownloaded,
    hasError,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    setAllowPrerelease,
    setAutoCheckEnabled,
    setCheckFrequency,
    setUpdateCheckUrl,
  } = useUpdater();
  const [updateUrlDraft, setUpdateUrlDraft] = useState(updateCheckUrl);

  useEffect(() => setUpdateUrlDraft(updateCheckUrl), [updateCheckUrl]);

  return (
    <div className="animate-in space-y-6 fade-in slide-in-from-bottom-2 transition-[opacity,transform] duration-300 motion-reduce:animate-none motion-reduce:transform-none motion-reduce:transition-none">
      <div>
        <h2 className="text-2xl font-bold mb-1">{translateSettings("settings.updates")}</h2>
        <p className="text-zinc-400">
          {translateSettings("settings.manageApplicationUpdatesAndReleaseChannels")}
        </p>
      </div>

      {anyRowVisible(
        "Allow Pre-release Updates",
        "Check for updates on startup",
        "Update check URL",
        "Check frequency",
        "Check for Updates"
      ) && (
        <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
          <div className="p-6 border-b border-[#27272a]">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                <LuRefreshCw className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-semibold text-lg">
                  {translateSettings("settings.softwareUpdate")}
                </h3>
                <p className="text-sm text-zinc-500">
                  {translateSettings("settings.currentVersionV")}
                  {appVersion ?? "0.0.0"}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {isRowVisible("Update check URL") && (
              <div>
                <label htmlFor="update-check-url" className="font-medium text-zinc-200">
                  {translateSettings("settings.updateCheckUrl")}
                </label>
                <p className="text-sm text-zinc-500 mt-1 mb-3">
                  {translateSettings(
                    "settings.electronUpdateFeedContainingThePlatformUpdateMetadata"
                  )}
                </p>
                <input
                  id="update-check-url"
                  type="url"
                  value={updateUrlDraft}
                  onChange={(event) => setUpdateUrlDraft(event.target.value)}
                  onBlur={() => void setUpdateCheckUrl(updateUrlDraft)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2 text-sm text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20"
                />
              </div>
            )}

            {isRowVisible("Allow Pre-release Updates") && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-zinc-200">
                    {translateSettings("settings.allowPreReleaseUpdates")}
                  </p>
                  <p className="text-sm text-zinc-500 mt-1">
                    {translateSettings("settings.receiveBetaAndPreviewVersionsBeforeStableRelease")}
                  </p>
                </div>
                <Switch
                  checked={allowPrerelease}
                  onCheckedChange={setAllowPrerelease}
                  className="data-[state=checked]:!bg-blue-500 data-[state=checked]:!border-blue-500"
                  thumbClassName="data-[state=checked]:!bg-white"
                />
              </div>
            )}

            {isRowVisible("Check for updates on startup") && (
              <div className="flex items-center justify-between pt-6 border-t border-[#27272a]">
                <div>
                  <p className="font-medium text-zinc-200">
                    {translateSettings("settings.checkForUpdatesOnStartup")}
                  </p>
                  <p className="text-sm text-zinc-500 mt-1">
                    {translateSettings("settings.checkAtLaunchWhenTheSelectedIntervalHasElapsed")}
                  </p>
                </div>
                <Switch
                  aria-label={translateSettings("settings.checkForUpdatesOnStartup")}
                  checked={autoCheckEnabled}
                  onCheckedChange={setAutoCheckEnabled}
                  className="data-[state=checked]:!bg-blue-500 data-[state=checked]:!border-blue-500"
                  thumbClassName="data-[state=checked]:!bg-white"
                />
              </div>
            )}

            {isRowVisible("Check frequency") && (
              <div className="flex items-center justify-between">
                <div>
                  <p
                    className={cn(
                      "font-medium",
                      autoCheckEnabled ? "text-zinc-200" : "text-zinc-500"
                    )}
                  >
                    {translateSettings("settings.checkFrequency")}
                  </p>
                  <p className="text-sm text-zinc-500 mt-1">
                    {translateSettings("settings.minimumTimeBetweenStartupChecks")}
                  </p>
                </div>
                <Select
                  value={checkFrequency}
                  onValueChange={(value) => setCheckFrequency(value as CheckFrequency)}
                  disabled={!autoCheckEnabled}
                >
                  <SelectTrigger
                    aria-label={translateSettings("settings.checkFrequency")}
                    className="w-[180px] flex-shrink-0 bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-blue-500/20 disabled:opacity-50"
                  >
                    <SelectValue placeholder={translateSettings("settings.selectFrequency")} />
                  </SelectTrigger>
                  <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                    <SelectItem value="hourly">{translateSettings("settings.hourly")}</SelectItem>
                    <SelectItem value="daily">{translateSettings("settings.daily")}</SelectItem>
                    <SelectItem value="weekly">{translateSettings("settings.weekly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {isRowVisible("Check for Updates") && (
              <div className="flex items-center justify-between pt-6 border-t border-[#27272a]">
                <div>
                  <p className="font-medium text-zinc-200">
                    {translateSettings("settings.checkForUpdates")}
                  </p>
                  <p className="text-sm text-zinc-500 mt-1">
                    {status === "idle" &&
                      translateSettings("settings.clickToCheckForAvailableUpdates")}
                    {status === "checking" && translateSettings("settings.checkingForUpdates")}
                    {status === "not-available" &&
                      translateSettings("settings.youAreOnTheLatestVersion")}
                    {status === "available" &&
                      translateSettings("settings.versionValueIsAvailable", {
                        value1: updateInfo?.version,
                      })}
                    {status === "downloading" && translateSettings("settings.downloadingUpdate")}
                    {status === "downloaded" && translateSettings("settings.updateReadyToInstall")}
                    {status === "error" && translateSettings("settings.failedToCheckForUpdates")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkForUpdates}
                  disabled={isChecking || isDownloading}
                  className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
                >
                  <LuRefreshCw className={`w-4 h-4 mr-2 ${isChecking ? "animate-spin" : ""}`} />
                  {translateSettings("settings.checkNow")}
                </Button>
              </div>
            )}

            {hasError && updateError && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                <LuTriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm">{updateError}</p>
                </div>
              </div>
            )}

            {isUpdateAvailable && updateInfo && (
              <div className="bg-[#18181b] rounded-lg border border-[#27272a] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-white">
                      {updateInfo.releaseName ||
                        translateSettings("settings.versionValue", { value1: updateInfo.version })}
                    </p>
                    {updateInfo.releaseDate && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {translateSettings("settings.released")}
                        {new Date(updateInfo.releaseDate).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <Button size="sm" onClick={downloadUpdate} disabled={isDownloading}>
                    <LuDownload className="w-4 h-4 mr-2" />
                    {translateSettings("settings.downloadUpdate")}
                  </Button>
                </div>
                {updateInfo.releaseNotes && (
                  <div className="text-sm text-zinc-400 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono bg-[#09090b] p-3 rounded border border-[#27272a]">
                    {updateInfo.releaseNotes}
                  </div>
                )}
              </div>
            )}

            {isDownloading && progress && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{translateSettings("settings.downloading")}</span>
                  <span>{Math.round(progress.percent)}%</span>
                </div>
                <Progress value={progress.percent} className="h-2" />
              </div>
            )}

            {isUpdateDownloaded && (
              <Button onClick={installUpdate} className="w-full">
                <LuRocket className="w-4 h-4 mr-2" /> {translateSettings("settings.restartInstall")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarItem({
  tab,
  icon: Icon,
  label,
  isActive,
  onSelect,
}: {
  tab: TabKey;
  icon: IconType;
  label: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <Link
      to="/settings"
      search={{ tab }}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        onSelect();
      }}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-inset motion-reduce:transition-none",
        isActive
          ? "bg-[#404040] text-[var(--color-foreground)]"
          : "text-[var(--color-foreground-secondary)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-foreground)]"
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
    </Link>
  );
}

function formatDesktopNotificationStatus(supported: boolean, permission: string): string {
  if (!supported || permission === "unsupported") {
    return "Desktop notifications unsupported";
  }
  if (permission === "denied") {
    return "Desktop notifications blocked";
  }
  if (permission === "granted") {
    return "Desktop notifications allowed";
  }
  if (permission === "default") {
    return "Desktop notifications not allowed yet";
  }
  return "Desktop notification support available";
}

function formatPlatformLabel(platform: Platform): string {
  return platform === "twitch" ? "Twitch" : "Kick";
}

function formatCarouselIntervalLabel(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${seconds} seconds`;
}

// Format a token expiry (Unix ms) for the API/Tokens panel. `null`/`undefined`
// means the platform reports no expiry — shown honestly as "unknown" rather
// than fabricating a date.
function formatExpiry(expiresAt: number | null | undefined): string {
  if (expiresAt == null) return "unknown";
  return new Date(expiresAt).toLocaleString();
}

/**
 * Read-only token-status panel for one platform (U14). Renders four states from
 * the `auth.tokenStatus` IPC result: not-connected, loading, valid, and
 * invalid/expired. "Validate now" re-runs the IPC; "Reconnect" runs the
 * existing login action. Never sees or shows a token value — the IPC returns
 * `TokenStatusResult` (status/identity/expiry/scopes only).
 */
function ApiTokenPanel({
  platform,
  label,
  onOpenIntegrations,
}: {
  platform: Platform;
  label: string;
  onOpenIntegrations: () => void;
}) {
  const loginTwitch = useAuthStore((state) => state.loginTwitch);
  const loginKick = useAuthStore((state) => state.loginKick);
  const reconnect = platform === "twitch" ? loginTwitch : loginKick;

  const [status, setStatus] = useState<TokenStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const validate = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.auth.tokenStatus(platform);
      setStatus(result);
    } catch {
      // IPC failure → treat as a probe we couldn't complete; show invalid so
      // the user gets a reconnect affordance rather than a blank panel.
      setStatus({ platform, connected: true, valid: false });
    } finally {
      setLoading(false);
    }
  }, [platform]);

  // Validate once when the panel mounts (i.e. when the API/Tokens tab opens).
  useEffect(() => {
    void validate();
  }, [validate]);

  const accent = platform === "twitch" ? "#9146FF" : "#53FC18";
  const notConnected = status != null && !status.connected;
  const isValid = status?.connected === true && status.valid === true;
  const isInvalid = status?.connected === true && status.valid === false;

  return (
    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
        <div className="flex items-center gap-3">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: accent }}
            aria-hidden
          />
          <h3 className="font-semibold text-lg">{label}</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void validate()}
          disabled={loading}
          className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
        >
          <LuRefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
          {translateSettings("settings.validateNow")}
        </Button>
      </div>

      <div className="px-6 py-5">
        {/* Loading — initial probe in flight (no prior result yet). */}
        {loading && status == null && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <LuRefreshCw className="w-4 h-4 animate-spin" />
            {translateSettings("settings.validating")}
          </div>
        )}

        {/* Not signed in. */}
        {notConnected && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">{translateSettings("settings.notSignedIn")}</p>
            <button
              type="button"
              onClick={onOpenIntegrations}
              className="text-sm font-medium hover:underline"
              style={{ color: accent }}
            >
              {translateSettings("settings.connectInIntegrations")}
            </button>
          </div>
        )}

        {/* Invalid / expired — offer a reconnect. */}
        {isInvalid && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <LuCircleX className="w-4 h-4" />
              {translateSettings("settings.tokenInvalidOrExpired")}
            </div>
            <Button
              size="sm"
              onClick={() => void reconnect()}
              className="text-white"
              style={{ backgroundColor: accent }}
            >
              {translateSettings("settings.reconnect")}
            </Button>
          </div>
        )}

        {/* Valid — identity, expiry, and granted scopes. */}
        {isValid && status && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-400">
              <LuCircleCheck className="w-4 h-4" />
              {translateSettings("settings.tokenValid")}
            </div>

            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-zinc-500">{translateSettings("settings.login")}</dt>
              <dd className="text-zinc-200 break-all">{status.login ?? "—"}</dd>
              <dt className="text-zinc-500">{translateSettings("settings.userId")}</dt>
              <dd className="text-zinc-200 break-all tabular-nums">{status.userId ?? "—"}</dd>
              <dt className="text-zinc-500">{translateSettings("settings.expires")}</dt>
              <dd className="text-zinc-200">{formatExpiry(status.expiresAt)}</dd>
            </dl>

            <div>
              <p className="text-sm text-zinc-500 mb-2">
                {translateSettings("settings.grantedScopes")}
              </p>
              {status.scopes && status.scopes.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {status.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="px-2 py-0.5 text-xs font-medium rounded-md bg-[#18181b] border border-[#27272a] text-zinc-300"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-600">
                  {translateSettings("settings.noScopesReported")}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
