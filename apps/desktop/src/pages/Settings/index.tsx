import { useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { IoMdSettings } from "react-icons/io";
import {
  LuBug,
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

import { AccountConnect } from "@/components/auth";
import {
  getAdBlockDeviceId,
  randomizeAdBlockDeviceId,
} from "@/components/player/twitch/twitch-adblock-device-id";
import { BugReportSection } from "@/components/settings/BugReportSection";
import { ChatSettingsSection } from "@/components/settings/ChatSettingsSection";
import { LogsSection } from "@/components/settings/LogsSection";
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
import { useAuthError } from "@/hooks/useAuth";
import { notifySettingsSaved } from "@/lib/settings-toast";
import { cn } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";
import {
  type BufferPreferences,
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  DEFAULT_PLAYBACK_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PREDICTION_PREFERENCES,
  DEFAULT_PROXY_PREFERENCES,
  type PlaybackAdvancedPlayerType,
  type PlaybackAdvancedPreferences,
  type PlayerControlsPreferences,
  type PredictionPreferences,
  type VideoQuality,
} from "@/shared/auth-types";
import type { CheckFrequency, TokenStatusResult } from "@/shared/ipc-channels";
import { useAdBlockStore } from "@/store/adblock-store";
import {
  HOME_CAROUSEL_INTERVAL_MAX_MS,
  HOME_CAROUSEL_INTERVAL_MIN_MS,
  useAppStore,
} from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import {
  type BackgroundQuality,
  MULTIVIEW_CAP_MAX,
  MULTIVIEW_CAP_MIN,
  useMultiStreamStore,
} from "@/store/multistream-store";

const SETTINGS_TABS = [
  "playback",
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
    label: "Target live latency",
    description: "Segments from the live edge. Lower stays closer to live but is less stable.",
    min: 1,
    max: 10,
    step: 1,
    unit: "seg",
  },
  {
    field: "maxBufferLengthSec",
    label: "Forward buffer",
    description: "Seconds of video buffered ahead. Higher resists stalls but adds latency.",
    min: 5,
    max: 60,
    step: 1,
    unit: "s",
  },
  {
    field: "maxMaxBufferLengthSec",
    label: "Max buffer",
    description: "Hard cap on buffered seconds. The byte budget scales with this value.",
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
  { field: "showQuality", label: "Quality", description: "Stream quality selector menu item." },
  {
    field: "showPlaybackSpeed",
    label: "Playback speed",
    description: "Speed selector (VOD playback).",
  },
  { field: "showVolume", label: "Volume", description: "Volume slider and mute button." },
  { field: "showFullscreen", label: "Fullscreen", description: "Fullscreen toggle button." },
  { field: "showTheater", label: "Theater", description: "Theater-mode toggle button." },
  { field: "showVideoStats", label: "Video Stats", description: "Live video stats overlay." },
];

// Player-type options for the advanced stream-token control (U13). "default" is
// the behavior-neutral sentinel; the rest are the ad-block `PlayerType` union.
const PLAYBACK_ADVANCED_PLAYER_TYPES: { value: PlaybackAdvancedPlayerType; label: string }[] = [
  { value: "default", label: "Default (recommended)" },
  { value: "site", label: "site" },
  { value: "embed", label: "embed" },
  { value: "popout", label: "popout" },
  { value: "autoplay", label: "autoplay" },
  { value: "picture-by-picture", label: "picture-by-picture" },
  { value: "thunderdome", label: "thunderdome" },
];

// Per-tab metadata (sidebar label, description, icon). Single source of truth
// for the sidebar render + the settings-search haystack, so adding a tab only
// needs editing in one place.
type TabKey = (typeof SETTINGS_TABS)[number];
const TAB_META: Record<TabKey, { label: string; description: string; icon: typeof LuMonitor }> = {
  playback: { label: "Playback", description: "Stream quality & preferences", icon: LuMonitor },
  "player-controls": {
    label: "Player controls",
    description: "Show or hide player buttons",
    icon: LuSlidersHorizontal,
  },
  buffer: { label: "Buffer", description: "Live latency & stability", icon: LuGauge },
  multiview: {
    label: "Multiview",
    description: "Slot count & memory trade-off",
    icon: LuLayoutGrid,
  },
  chat: { label: "Chat", description: "Appearance, emotes & events", icon: LuMessageSquare },
  adblock: { label: "Ad-Block", description: "Twitch ad-blocking settings", icon: LuShieldCheck },
  proxy: { label: "Proxy", description: "Route Twitch traffic via a proxy", icon: LuNetwork },
  predictions: {
    label: "Predictions",
    description: "Chat prediction widget style",
    icon: LuTrophy,
  },
  integrations: {
    label: "Integrations",
    description: "Connected accounts & APIs",
    icon: LuLink,
  },
  "api-tokens": {
    label: "API / Tokens",
    description: "Sign-in & token status",
    icon: LuKeyRound,
  },
  updates: { label: "Updates", description: "Auto update preferences", icon: LuRefreshCw },
  logs: { label: "Logs", description: "In-app log viewer & diagnostics", icon: LuFileText },
  "report-bug": {
    label: "Report Bug",
    description: "Capture a bug report for sharing",
    icon: LuBug,
  },
  about: { label: "About", description: "Version & info", icon: LuCircleHelp },
};

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
    tab: "playback",
    label: "Default Quality",
    description: "Preferred stream quality when available",
    keywords: ["1440p", "2k", "1080p", "720p", "480p", "360p", "160p", "auto", "resolution"],
  },
  {
    tab: "playback",
    label: "Featured carousel timing",
    description: "How long each home page featured stream stays active",
    keywords: ["home", "featured", "banner", "carousel", "rotate", "seconds", "minutes"],
  },
  {
    tab: "playback",
    label: "Access-token player type",
    description: "Player type used when requesting the ad-block stream token",
    keywords: ["advanced", "site", "embed", "popout", "autoplay", "thunderdome"],
  },
  {
    tab: "playback",
    label: "Allow HEVC (H.265)",
    description: "Keep HEVC streams instead of swapping to AVC during ads",
    keywords: ["codec", "h265", "advanced"],
  },
  {
    tab: "playback",
    label: "Stream device ID",
    description: "Identifier sent with the ad-block stream token",
    keywords: ["randomize", "device", "advanced"],
  },
  // Player controls — array entries (one per toggle in PLAYER_CONTROL_TOGGLES).
  { tab: "player-controls", label: "Quality", description: "Stream quality selector menu item." },
  {
    tab: "player-controls",
    label: "Playback speed",
    description: "Speed selector (VOD playback).",
  },
  { tab: "player-controls", label: "Volume", description: "Volume slider and mute button." },
  {
    tab: "player-controls",
    label: "Fullscreen",
    description: "Fullscreen toggle button.",
  },
  { tab: "player-controls", label: "Theater", description: "Theater-mode toggle button." },
  {
    tab: "player-controls",
    label: "Video Stats",
    description: "Live video stats overlay.",
  },
  // Buffer
  {
    tab: "buffer",
    label: "Low-latency mode",
    description: "Track the live edge aggressively.",
    keywords: ["latency"],
  },
  {
    tab: "buffer",
    label: "Target live latency",
    description: "Segments from the live edge.",
    keywords: ["livesync"],
  },
  {
    tab: "buffer",
    label: "Forward buffer",
    description: "Seconds of video buffered ahead.",
  },
  { tab: "buffer", label: "Max buffer", description: "Hard cap on buffered seconds." },
  // Multiview (slice 03 + slice 08 background-quality row).
  {
    tab: "multiview",
    label: "Maximum concurrent streams",
    description: "User-configurable upper bound on simultaneous StreamSlots",
    keywords: ["multistream", "slots", "cap", "ram", "memory", "grid", "tiles"],
  },
  {
    tab: "multiview",
    label: "Background-stream quality",
    description: "How non-focused slots render: auto-low / match-source / off",
    keywords: ["background", "quality", "480p", "ram", "memory", "auto-low", "match-source"],
  },
  // Chat — content delegated to ChatSettingsSection. One umbrella entry so the
  // tab surfaces for "emotes", "events", "bttv", etc.
  {
    tab: "chat",
    label: "Chat",
    description: "Appearance, emotes, events, behavior",
    keywords: ["bttv", "7tv", "ffz", "raid", "sub", "emote", "events", "messages"],
  },
  {
    tab: "adblock",
    label: "Enable Ad-Blocking",
    description: "Block Twitch ads using alternative player tokens",
    keywords: ["vaft"],
  },
  // Proxy — listed per-field so any field name jumps to the tab, but the form
  // renders as a single unit so users see the full context.
  {
    tab: "proxy",
    label: "Enable proxy",
    description: "Routes Twitch traffic through the host",
  },
  { tab: "proxy", label: "Host", description: "Proxy host or IP", keywords: ["server"] },
  { tab: "proxy", label: "Port", description: "Proxy port number" },
  {
    tab: "proxy",
    label: "Credentials",
    description: "Username and password for the proxy",
    keywords: ["username", "password", "auth"],
  },
  {
    tab: "predictions",
    label: "Style",
    description: "Visual style for the chat prediction widget",
    keywords: ["native", "unified"],
  },
  {
    tab: "integrations",
    label: "Connected Accounts",
    description: "Twitch and Kick account connections",
    keywords: ["sign in", "login", "auth"],
  },
  {
    tab: "api-tokens",
    label: "Token Status",
    description: "Sign-in and token validity",
    keywords: ["scopes", "expiry", "twitch", "kick"],
  },
  {
    tab: "updates",
    label: "Allow Pre-release Updates",
    description: "Receive beta and preview versions before stable release",
    keywords: ["beta"],
  },
  {
    tab: "updates",
    label: "Automatically check for updates",
    description: "Check for new versions in the background on a schedule",
  },
  {
    tab: "updates",
    label: "Check frequency",
    description: "How often to check when automatic updates are on",
    keywords: ["hourly", "daily", "weekly"],
  },
  {
    tab: "updates",
    label: "Check for Updates",
    description: "Check for available updates now",
  },
  { tab: "logs", label: "Logs", description: "In-app log viewer and diagnostics" },
  { tab: "report-bug", label: "Report a Bug", description: "Generate a bug report file" },
  { tab: "about", label: "About", description: "Version and info" },
];

export function SettingsPage() {
  const canRenderSettingsPanel = useAfterFirstPaint();
  const appVersion = useAppVersion();
  const versionInfo = useAppVersionInfo();
  // Dev gate. While the env probe is in flight we conservatively treat the
  // build as prod so dev-only panels never flash in a packaged install.
  const [isDev, setIsDev] = useState(false);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.env
      ?.get()
      .then((env) => {
        if (!cancelled) setIsDev(env.isDev);
      })
      .catch(() => {
        if (!cancelled) setIsDev(false);
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
  const initialTab =
    isValidTab && (!requestedIsDevOnly || isDev) ? (requestedTab as string) : "playback";
  const [activeTab, setActiveTab] = useState(initialTab);

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
    if (firstMatch) setActiveTab(firstMatch);
  }, [searchMatches, activeTab, isDev]);

  // True iff the currently active tab has at least one matching setting (or
  // search is inactive). When false, the content area renders an empty state.
  const activeTabHasMatches =
    !searchMatches.active || (searchMatches.tabs?.has(activeTab as TabKey) ?? false);

  // If the active tab is dev-only and the env probe resolves to prod, snap
  // back to the default tab so the panel area never renders dev-only content.
  useEffect(() => {
    if (!isDev && DEV_ONLY_TABS.has(activeTab as (typeof SETTINGS_TABS)[number])) {
      setActiveTab("playback");
    }
  }, [isDev, activeTab]);

  // Get auth state
  const { error, clearError } = useAuthError();
  const preferences = useAuthStore((state) => state.preferences);
  const updatePreferences = useAuthStore((state) => state.updatePreferences);

  // Ad-block state
  const enableAdBlock = useAdBlockStore((state) => state.enableAdBlock);
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

  // Multiview state (slice 03 + slice 08). MultiviewCap is the user-
  // configurable upper bound on simultaneous StreamSlots; BackgroundQuality
  // controls how non-focused slots render (auto-low / match-source / off).
  const multiviewCap = useMultiStreamStore((state) => state.multiviewCap);
  const setMultiviewCap = useMultiStreamStore((state) => state.setMultiviewCap);
  const backgroundQuality = useMultiStreamStore((state) => state.backgroundQuality);
  const setBackgroundQualityInStore = useMultiStreamStore((state) => state.setBackgroundQuality);
  const activeStreamCount = useMultiStreamStore((state) => state.streams.length);
  const handleMultiviewCapChange = (next: number) => {
    setMultiviewCap(next);
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

  // Updater state
  const {
    status,
    updateInfo,
    progress,
    error: updateError,
    allowPrerelease,
    autoCheckEnabled,
    checkFrequency,
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
  } = useUpdater();

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
  const buffer = preferences?.buffer ?? DEFAULT_BUFFER_PREFERENCES;

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
    notifySettingsSaved("Stream device ID randomized");
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
    <div className="flex h-full bg-[#09090b] text-zinc-100 overflow-hidden">
      {/* Sidebar Navigation */}
      <div className="w-[280px] flex-shrink-0 flex flex-col border-r border-[#27272a] bg-[#121214]">
        <div className="p-6 pb-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <IoMdSettings className="w-6 h-6 text-zinc-400" />
            Settings
          </h1>
          <p className="text-zinc-500 text-xs font-medium mt-1 uppercase tracking-wide opacity-80">
            App Settings & Project Settings
          </p>
        </div>

        {/* Search bar — filters sidebar to tabs containing matches and hides
            non-matching rows within the active tab. */}
        <div className="px-6 pt-3 pb-1">
          <div className="relative">
            <LuSearch
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none"
              aria-hidden
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search settings"
              aria-label="Search settings"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-[#27272a] bg-[#18181b] pl-9 pr-9 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/30 focus:border-zinc-500/40"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-[#27272a]"
              >
                <LuX className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2 px-3 space-y-6">
          {/* Section: APP SETTINGS */}
          <div className="space-y-1">
            <h3 className="px-3 text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 mt-4">
              App Settings
            </h3>

            {SETTINGS_TABS.map((tab) => {
              if (DEV_ONLY_TABS.has(tab) && !isDev) return null;
              if (searchMatches.active && searchMatches.tabs && !searchMatches.tabs.has(tab))
                return null;
              const meta = TAB_META[tab];
              return (
                <SidebarItem
                  key={tab}
                  icon={meta.icon}
                  label={meta.label}
                  description={meta.description}
                  isActive={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                />
              );
            })}

            {searchMatches.active && searchMatches.tabs && searchMatches.tabs.size === 0 && (
              <p className="px-3 py-6 text-sm text-zinc-500 text-center">
                No settings match "{searchQuery}".
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto bg-[#09090b]">
        <div className="max-w-4xl p-8 py-10">
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
              <h2 className="text-lg font-semibold text-zinc-200 mb-1">No settings found</h2>
              <p className="text-sm text-zinc-500 mb-4">Nothing matches "{searchQuery}".</p>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="text-sm font-medium text-zinc-300 hover:text-white hover:underline"
              >
                Clear search
              </button>
            </div>
          ) : (
            <>
              {/* Playback Tab */}
              {activeTab === "playback" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Playback</h2>
                    <p className="text-zinc-400">Manage your default stream viewing experience.</p>
                  </div>

                  {isRowVisible("Default Quality") && (
                    <div className="p-1 rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="p-6">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium text-zinc-200">Default Quality</p>
                            <p className="text-sm text-zinc-500 mt-1">
                              Preferred stream quality when available
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
                              <SelectTrigger className="w-[180px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-yellow-500/20">
                                <SelectValue placeholder="Select quality" />
                              </SelectTrigger>
                              <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                                <SelectItem value="auto">Auto</SelectItem>
                                <SelectItem value="1440p">1440p / 2K</SelectItem>
                                <SelectItem value="1080p">1080p60</SelectItem>
                                <SelectItem value="720p">720p60</SelectItem>
                                <SelectItem value="480p">480p</SelectItem>
                                <SelectItem value="360p">360p</SelectItem>
                                <SelectItem value="160p">160p</SelectItem>
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
                            <p className="font-medium text-zinc-200">Featured carousel timing</p>
                            <p className="text-sm text-zinc-500 mt-1">
                              How long each home page featured stream stays active before rotating.
                              Current: {formatCarouselIntervalLabel(homeCarouselIntervalSeconds)}.
                            </p>
                          </div>

                          <div className="flex w-full items-center gap-3 sm:w-[360px]">
                            <input
                              type="range"
                              aria-label="Featured carousel timing"
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
                                aria-label="Featured carousel timing seconds"
                                min={homeCarouselIntervalMinSeconds}
                                max={homeCarouselIntervalMaxSeconds}
                                step={HOME_CAROUSEL_INTERVAL_STEP_SECONDS}
                                value={homeCarouselIntervalSeconds}
                                onChange={(e) =>
                                  handleHomeCarouselIntervalChange(Number(e.target.value))
                                }
                                className="h-9 w-16 rounded-l-lg bg-transparent px-2 text-right text-zinc-200 outline-none"
                              />
                              sec
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
                          Advanced (stream token)
                        </h3>
                      </div>

                      {/* Persistent danger banner */}
                      <div className="mx-6 mt-4 flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300/90">
                        <LuTriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <p className="text-sm leading-relaxed">
                          These affect how the Twitch stream token is requested. Wrong values can
                          break playback. Defaults match the current configuration. They apply
                          through the ad-block pipeline only. With ad-block off, the standard player
                          is unaffected.
                        </p>
                      </div>

                      <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                        {/* Player type */}
                        {isRowVisible("Access-token player type") && (
                          <div className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-zinc-200">Access-token player type</p>
                              <p className="text-sm text-zinc-500 mt-0.5">
                                Player type used when requesting the ad-block stream token. Leave on
                                Default unless a specific type is needed.
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
                                aria-label="Access-token player type"
                                className="w-[200px] flex-shrink-0 bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-amber-500/20"
                              >
                                <SelectValue placeholder="Select player type" />
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
                              <p className="font-medium text-zinc-200">Allow HEVC (H.265)</p>
                              <p className="text-sm text-zinc-500 mt-0.5">
                                Keep HEVC streams instead of swapping to AVC during ads. Off by
                                default. Enabling can break playback if the decoder can't switch
                                cleanly.
                              </p>
                            </div>
                            <Switch
                              checked={playbackAdvanced.allowHevc}
                              onCheckedChange={(v) => handlePlaybackAdvancedChange("allowHevc", v)}
                              aria-label="Allow HEVC"
                            />
                          </div>
                        )}

                        {/* Device-id randomize */}
                        {isRowVisible("Stream device ID") && (
                          <div className="flex items-center justify-between gap-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-zinc-200">Stream device ID</p>
                              <p className="text-sm text-zinc-500 mt-0.5">
                                Identifier sent with the ad-block stream token.{" "}
                                {adBlockDeviceId ? (
                                  <>
                                    Current:{" "}
                                    <code className="text-zinc-400">
                                      {adBlockDeviceId.slice(0, 8)}…
                                    </code>
                                  </>
                                ) : (
                                  "Not yet generated (set on first stream load)."
                                )}{" "}
                                Randomizing takes effect on the next stream load.
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleRandomizeDeviceId}
                              className="flex-shrink-0 bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
                            >
                              Randomize
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Player Controls Tab */}
              {activeTab === "player-controls" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Player controls</h2>
                    <p className="text-zinc-400">
                      Choose which buttons appear in the player. Hiding a control only removes its
                      button — it never changes playback (audio keeps playing, quality stays
                      selected).
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
                            Visible controls
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
                </div>
              )}

              {/* Buffer Tab */}
              {activeTab === "buffer" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Buffer</h2>
                    <p className="text-zinc-400">
                      Tune the latency-vs-stability tradeoff for live streams (Twitch + Kick). These
                      apply to live playback only.
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
                            Live buffer
                          </h3>
                          <div className="flex items-center gap-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleBufferReset}
                              className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
                            >
                              Reset to defaults
                            </Button>
                          </div>
                        </div>

                        <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                          {/* Low-latency mode switch */}
                          {showLowLatency && (
                            <div className="flex items-center justify-between gap-4 py-3">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-zinc-200">Low-latency mode</p>
                                <p className="text-sm text-zinc-500 mt-0.5">
                                  Track the live edge aggressively. Disable for steadier playback on
                                  flaky connections.
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
                          Changes apply when the stream next loads.
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Multiview Tab (slice 03) — exposes MultiviewCap. Background
                  stream quality lands here in slice 08; today this tab only
                  surfaces the cap slider. */}
              {activeTab === "multiview" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Multiview</h2>
                    <p className="text-zinc-400">
                      Set how many streams you can watch side by side, and how the app spends memory
                      on background streams.
                    </p>
                  </div>

                  {isRowVisible("Maximum concurrent streams") && (
                    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="flex items-center justify-between px-6 py-4 border-b border-[#27272a]">
                        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                          Multiview cap
                        </h3>
                      </div>

                      <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                        <div className="flex items-center justify-between gap-4 py-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-zinc-200">Maximum concurrent streams</p>
                            <p className="text-sm text-zinc-500 mt-0.5 leading-relaxed">
                              Each extra stream gets its own renderer process for crash isolation,
                              so every step up costs real memory. Pick the lowest number you
                              actually watch at once. Most viewers do well at 4. Bump it to 6 if you
                              regularly run a full grid and have RAM to spare; drop to 2 on tight
                              machines.
                            </p>
                            {activeStreamCount > multiviewCap && (
                              <p className="text-xs text-amber-400 mt-2">
                                You have {activeStreamCount} streams open. Lowering the cap below
                                the current count won't close any open streams; it only blocks new
                                ones from being added.
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <input
                              type="range"
                              min={MULTIVIEW_CAP_MIN}
                              max={MULTIVIEW_CAP_MAX}
                              step={1}
                              value={multiviewCap}
                              onChange={(e) =>
                                handleMultiviewCapChange(Number.parseInt(e.target.value, 10))
                              }
                              className="w-40 accent-zinc-300"
                              aria-label="Maximum concurrent streams"
                            />
                            <span className="w-16 text-right text-sm tabular-nums text-zinc-200">
                              {multiviewCap} {multiviewCap === 1 ? "stream" : "streams"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="px-6 py-3 border-t border-[#27272a] text-xs text-zinc-500">
                        Range: {MULTIVIEW_CAP_MIN}–{MULTIVIEW_CAP_MAX}. Default is 4.
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
                          Background streams
                        </h3>
                      </div>

                      <div className="px-6 py-2 divide-y divide-[#27272a]/60">
                        <div className="flex items-center justify-between gap-4 py-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-zinc-200">Background-stream quality</p>
                            <p className="text-sm text-zinc-500 mt-0.5 leading-relaxed">
                              How non-focused streams render. Lower settings free up RAM and
                              bandwidth so the focused stream gets the full pipe. Changes apply live
                              to every background slot — no app reload needed.
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
                                aria-label="Background-stream quality"
                                className="w-[200px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-zinc-500/30"
                              >
                                <SelectValue placeholder="Select quality" />
                              </SelectTrigger>
                              <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                                <SelectItem value="auto-low">
                                  Auto-low (≤480p, recommended)
                                </SelectItem>
                                <SelectItem value="match-source">
                                  Match source (uses more RAM)
                                </SelectItem>
                                <SelectItem value="off">Off (audio-only)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      <div className="px-6 py-3 border-t border-[#27272a] text-xs text-zinc-500">
                        Default: auto-low.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Chat Tab */}
              {activeTab === "chat" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Chat</h2>
                    <p className="text-zinc-400">
                      Appearance, emotes, events, and behavior for the unified Twitch + Kick chat.
                    </p>
                  </div>

                  <ChatSettingsSection />
                </div>
              )}

              {/* Ad-Block Tab */}
              {activeTab === "adblock" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Ad-Block</h2>
                    <p className="text-zinc-400">
                      Manage ad-blocking capabilities for Twitch streams.
                    </p>
                  </div>

                  {isRowVisible("Enable Ad-Blocking") && (
                    <div className="p-6 rounded-xl border border-[#27272a] bg-[#121214]">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 rounded-lg bg-green-500/10 text-green-400">
                          <LuShieldCheck className="w-6 h-6" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">Client-Side Ad-Blocking</h3>
                          <p className="text-sm text-zinc-500">
                            Bypass Twitch advertisements locally
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 rounded-lg bg-[#18181b]/50 border border-[#27272a]">
                        <div>
                          <p className="font-medium text-zinc-200">Enable Ad-Blocking</p>
                          <p className="text-sm text-zinc-500 mt-1">
                            Block Twitch ads using alternative player tokens
                          </p>
                        </div>
                        <Switch
                          checked={enableAdBlock}
                          onCheckedChange={setEnableAdBlock}
                          className="data-[state=checked]:!bg-green-500 data-[state=checked]:!border-green-500"
                          thumbClassName="data-[state=checked]:!bg-white"
                        />
                      </div>
                      <div className="mt-4 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10 text-sm text-blue-300/80 leading-relaxed">
                        This uses the VAFT technique to request ad-free streams via backup player
                        types. It works without external proxies. A shield icon will appear in the
                        player when active.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Proxy Tab (U12 — drives the U11 main-process proxy) */}
              {activeTab === "proxy" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Proxy</h2>
                    <p className="text-zinc-400">
                      Route the app's outbound Twitch traffic through an HTTP/HTTPS proxy.
                    </p>
                  </div>

                  {anyRowVisible("Enable proxy", "Host", "Port", "Credentials") && (
                    <div className="rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="p-6 border-b border-[#27272a]">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
                            <LuNetwork className="w-6 h-6" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-lg">Outbound Proxy</h3>
                            <p className="text-sm text-zinc-500">
                              Applied to the app's Twitch requests
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="p-6 space-y-6">
                        {/* Enable switch */}
                        <div className="flex items-center justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-zinc-200">Enable proxy</p>
                            <p className="text-sm text-zinc-500 mt-1">
                              Off by default. Routes Twitch traffic through the host below.
                            </p>
                          </div>
                          <Switch
                            checked={proxyEnabled}
                            onCheckedChange={setProxyEnabled}
                            aria-label="Enable proxy"
                            className="data-[state=checked]:!bg-sky-500 data-[state=checked]:!border-sky-500"
                            thumbClassName="data-[state=checked]:!bg-white"
                          />
                        </div>

                        {/* Host */}
                        <div className="space-y-2">
                          <label htmlFor="proxy-host" className="block font-medium text-zinc-200">
                            Host
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
                            Host or IP only — no scheme (e.g. <code>127.0.0.1</code>, not{" "}
                            <code>http://…</code>).
                          </p>
                        </div>

                        {/* Port */}
                        <div className="space-y-2">
                          <label htmlFor="proxy-port" className="block font-medium text-zinc-200">
                            Port
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
                            <p className="text-xs text-zinc-500">A number between 1 and 65535.</p>
                          )}
                        </div>

                        {/* Credentials */}
                        <div className="pt-6 border-t border-[#27272a] space-y-4">
                          <div>
                            <p className="font-medium text-zinc-200">Credentials (optional)</p>
                            <p className="text-sm text-zinc-500 mt-1">
                              For a proxy that requires authentication. Stored encrypted on this
                              device and never displayed again.
                            </p>
                          </div>

                          <div className="space-y-2">
                            <label htmlFor="proxy-username" className="block text-sm text-zinc-400">
                              Username
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
                              Password
                            </label>
                            <div className="relative">
                              <input
                                id="proxy-password"
                                type={showProxyPassword ? "text" : "password"}
                                value={proxyPassword}
                                onChange={(e) => setProxyPassword(e.target.value)}
                                placeholder={
                                  proxyHasCredentials && proxyPassword === ""
                                    ? "••••• (saved)"
                                    : undefined
                                }
                                autoComplete="new-password"
                                className="w-full rounded-lg border border-[#27272a] bg-[#18181b] px-3 py-2 pr-10 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500/40"
                              />
                              <button
                                type="button"
                                onClick={() => setShowProxyPassword((v) => !v)}
                                aria-label={showProxyPassword ? "Hide password" : "Show password"}
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
                                Clear credentials
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Apply-failure banner (persistent, not a toast) */}
                        {proxyApplyError && (
                          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                            <LuTriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm font-medium">Couldn't apply the proxy</p>
                              <p className="text-sm mt-0.5 opacity-80">{proxyApplyError}</p>
                            </div>
                          </div>
                        )}

                        {/* Save row + status */}
                        <div className="flex items-center justify-between gap-4 pt-6 border-t border-[#27272a]">
                          <div className="min-h-[1.25rem]">
                            {proxyStatus === "saved" && (
                              <span className="text-sm text-yellow-500 font-medium animate-in fade-in slide-in-from-left-2 duration-300">
                                Saved
                              </span>
                            )}
                            {proxyStatus === "disabled" && (
                              <span className="text-sm text-zinc-500 font-medium">
                                Proxy disabled (no host set)
                              </span>
                            )}
                          </div>
                          <Button
                            onClick={handleProxySave}
                            className="bg-sky-500 hover:bg-sky-400 text-white"
                          >
                            Save & apply
                          </Button>
                        </div>
                      </div>

                      <div className="px-6 py-4 border-t border-[#27272a] text-xs text-zinc-500 leading-relaxed">
                        When enabled, the app's Twitch traffic — video, chat, API calls, and sign-in
                        — routes through this proxy, applied on the next requests. This is a single
                        app-wide proxy, not per-feature. It's off by default.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Predictions Tab */}
              {activeTab === "predictions" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Predictions</h2>
                    <p className="text-zinc-400">
                      Visual style for the chat prediction widget when a streamer runs a prediction.
                    </p>
                  </div>

                  {isRowVisible("Style") && (
                    <div className="p-1 rounded-xl border border-[#27272a] bg-[#121214] overflow-hidden">
                      <div className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="max-w-md">
                            <p className="font-medium text-zinc-200">Style</p>
                            <p className="text-sm text-zinc-500 mt-1">
                              Native matches each platform's own UI (Twitch purple with bubble
                              chart; Kick green/pink dot pairs). Unified uses StreamFusion's storm
                              accent on both platforms.
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <Select
                              value={preferences?.predictions?.style ?? "native"}
                              onValueChange={handlePredictionStyleChange}
                            >
                              <SelectTrigger className="w-[200px] bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-yellow-500/20">
                                <SelectValue placeholder="Select style" />
                              </SelectTrigger>
                              <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                                <SelectItem value="native">Native (per platform)</SelectItem>
                                <SelectItem value="unified">Unified StreamFusion</SelectItem>
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
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Integrations</h2>
                    <p className="text-zinc-400">Manage your connected accounts and services.</p>
                  </div>

                  {/* Auth Error Alert (Moved here) */}
                  {error && (
                    <div
                      className={`flex items-start gap-4 p-4 rounded-xl border mb-6 ${
                        error.platform === "twitch"
                          ? "bg-[#9146FF]/5 border-[#9146FF]/20 text-[#9146FF]"
                          : error.platform === "kick"
                            ? "bg-[#53FC18]/5 border-[#53FC18]/20 text-[#53FC18]"
                            : "bg-red-500/5 border-red-500/20 text-red-400"
                      }`}
                    >
                      <LuCircleAlert size={20} className="flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium">
                          {error.platform === "twitch"
                            ? "Twitch Connection Error"
                            : error.platform === "kick"
                              ? "Kick Connection Error"
                              : "Authentication Error"}
                        </p>
                        <p className="text-sm mt-1 opacity-80 leading-relaxed">{error.message}</p>
                      </div>
                      <button
                        onClick={clearError}
                        className="text-sm font-medium hover:underline opacity-80 hover:opacity-100"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}

                  {isRowVisible("Connected Accounts") && (
                    <div className="p-6 rounded-xl border border-[#27272a] bg-[#121214]">
                      <h3 className="font-semibold text-lg mb-4">Connected Accounts</h3>
                      <AccountConnect />
                    </div>
                  )}
                </div>
              )}

              {/* API / Tokens Tab (U14 — read-only token status) */}
              {activeTab === "api-tokens" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">API / Tokens</h2>
                    <p className="text-zinc-400">
                      Read-only status of your Twitch and Kick sign-in. Token values never leave
                      your device — this only shows identity, validity, expiry, and granted scopes.
                    </p>
                  </div>

                  {isRowVisible("Token Status") && (
                    <>
                      <ApiTokenPanel
                        platform="twitch"
                        label="Twitch"
                        onOpenIntegrations={() => setActiveTab("integrations")}
                      />
                      <ApiTokenPanel
                        platform="kick"
                        label="Kick"
                        onOpenIntegrations={() => setActiveTab("integrations")}
                      />
                    </>
                  )}
                </div>
              )}

              {/* Updates Tab */}
              {activeTab === "updates" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Updates</h2>
                    <p className="text-zinc-400">
                      Manage application updates and release channels.
                    </p>
                  </div>

                  {anyRowVisible(
                    "Allow Pre-release Updates",
                    "Automatically check for updates",
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
                            <h3 className="font-semibold text-lg">Software Update</h3>
                            <p className="text-sm text-zinc-500">
                              Current Version: v{appVersion ?? "0.0.0"}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="p-6 space-y-6">
                        {/* Pre-release Toggle */}
                        {isRowVisible("Allow Pre-release Updates") && (
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-zinc-200">Allow Pre-release Updates</p>
                              <p className="text-sm text-zinc-500 mt-1">
                                Receive beta and preview versions before stable release
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

                        {/* Automatic Check Toggle */}
                        {isRowVisible("Automatically check for updates") && (
                          <div className="flex items-center justify-between pt-6 border-t border-[#27272a]">
                            <div>
                              <p className="font-medium text-zinc-200">
                                Automatically check for updates
                              </p>
                              <p className="text-sm text-zinc-500 mt-1">
                                Check for new versions in the background on a schedule
                              </p>
                            </div>
                            <Switch
                              aria-label="Automatically check for updates"
                              checked={autoCheckEnabled}
                              onCheckedChange={setAutoCheckEnabled}
                              className="data-[state=checked]:!bg-blue-500 data-[state=checked]:!border-blue-500"
                              thumbClassName="data-[state=checked]:!bg-white"
                            />
                          </div>
                        )}

                        {/* Check Frequency */}
                        {isRowVisible("Check frequency") && (
                          <div className="flex items-center justify-between">
                            <div>
                              <p
                                className={cn(
                                  "font-medium",
                                  autoCheckEnabled ? "text-zinc-200" : "text-zinc-500"
                                )}
                              >
                                Check frequency
                              </p>
                              <p className="text-sm text-zinc-500 mt-1">
                                How often to check when automatic updates are on
                              </p>
                            </div>
                            <Select
                              value={checkFrequency}
                              onValueChange={(v) => setCheckFrequency(v as CheckFrequency)}
                              disabled={!autoCheckEnabled}
                            >
                              <SelectTrigger
                                aria-label="Check frequency"
                                className="w-[180px] flex-shrink-0 bg-[#18181b] border-[#27272a] text-zinc-200 focus:ring-blue-500/20 disabled:opacity-50"
                              >
                                <SelectValue placeholder="Select frequency" />
                              </SelectTrigger>
                              <SelectContent className="bg-[#18181b] border-[#27272a] text-zinc-200">
                                <SelectItem value="hourly">Hourly</SelectItem>
                                <SelectItem value="daily">Daily</SelectItem>
                                <SelectItem value="weekly">Weekly</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Check Button */}
                        {isRowVisible("Check for Updates") && (
                          <div className="flex items-center justify-between pt-6 border-t border-[#27272a]">
                            <div>
                              <p className="font-medium text-zinc-200">Check for Updates</p>
                              <p className="text-sm text-zinc-500 mt-1">
                                {status === "idle" && "Click to check for available updates"}
                                {status === "checking" && "Checking for updates..."}
                                {status === "not-available" && "You are on the latest version"}
                                {status === "available" &&
                                  `Version ${updateInfo?.version} is available`}
                                {status === "downloading" && "Downloading update..."}
                                {status === "downloaded" && "Update ready to install"}
                                {status === "error" && "Failed to check for updates"}
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={checkForUpdates}
                              disabled={isChecking || isDownloading}
                              className="bg-[#18181b] border-[#27272a] text-zinc-200 hover:bg-[#27272a] hover:text-white"
                            >
                              <LuRefreshCw
                                className={`w-4 h-4 mr-2 ${isChecking ? "animate-spin" : ""}`}
                              />
                              Check Now
                            </Button>
                          </div>
                        )}

                        {/* Errors */}
                        {hasError && updateError && (
                          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
                            <LuTriangleAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
                            <div className="flex-1">
                              <p className="text-sm">{updateError}</p>
                            </div>
                          </div>
                        )}

                        {/* Update Available */}
                        {isUpdateAvailable && updateInfo && (
                          <div className="bg-[#18181b] rounded-lg border border-[#27272a] p-4 space-y-4">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-bold text-white">
                                  {updateInfo.releaseName || `Version ${updateInfo.version}`}
                                </p>
                                {updateInfo.releaseDate && (
                                  <p className="text-xs text-zinc-500 mt-0.5">
                                    Released {new Date(updateInfo.releaseDate).toLocaleDateString()}
                                  </p>
                                )}
                              </div>
                              <Button size="sm" onClick={downloadUpdate} disabled={isDownloading}>
                                <LuDownload className="w-4 h-4 mr-2" />
                                Download Update
                              </Button>
                            </div>
                            {updateInfo.releaseNotes && (
                              <div className="text-sm text-zinc-400 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono bg-[#09090b] p-3 rounded border border-[#27272a]">
                                {updateInfo.releaseNotes}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Downloading */}
                        {isDownloading && progress && (
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span>Downloading...</span>
                              <span>{Math.round(progress.percent)}%</span>
                            </div>
                            <Progress value={progress.percent} className="h-2" />
                          </div>
                        )}

                        {/* Install */}
                        {isUpdateDownloaded && (
                          <Button onClick={installUpdate} className="w-full">
                            <LuRocket className="w-4 h-4 mr-2" /> Restart & Install
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Logs Tab — dev-only. The sidebar item is hidden in prod and a
              deep-link `?tab=logs` is redirected away above, but this guard
              keeps the panel itself off in case `activeTab` lags behind. */}
              {isDev && activeTab === "logs" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Logs</h2>
                    <p className="text-zinc-400">
                      Inspect the in-app log files. Useful for debugging playback, chat, and auth
                      issues — or for attaching to a bug report.
                    </p>
                  </div>

                  {isRowVisible("Logs") && <LogsSection />}
                </div>
              )}

              {/* Report Bug Tab — dev-only (gated by DEV_ONLY_TABS). */}
              {isDev && activeTab === "report-bug" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">Report a Bug</h2>
                    <p className="text-zinc-400">
                      Generate a bug report file you can share with someone debugging the issue.
                    </p>
                  </div>

                  {isRowVisible("Report a Bug") && <BugReportSection />}
                </div>
              )}

              {/* About Tab */}
              {activeTab === "about" && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div>
                    <h2 className="text-2xl font-bold mb-1">About</h2>
                    <p className="text-zinc-400">Application information.</p>
                  </div>

                  {isRowVisible("About") && (
                    <div className="p-8 rounded-xl border border-[#27272a] bg-[#121214] flex flex-col items-center text-center space-y-4">
                      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                        <LuRocket className="w-8 h-8 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-white">StreamFusion</h3>
                        <div className="flex items-center justify-center gap-2 mt-1">
                          <p className="text-zinc-500">
                            v{versionInfo?.version ?? appVersion ?? "0.1.0"}
                          </p>
                          {versionInfo?.isPrerelease && (
                            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                              Pre-release
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="pt-6 text-sm text-zinc-500">
                        <p>Built with Electron + React + TailwindCSS</p>
                        <p className="mt-1">Designed for the best streaming experience.</p>
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

function SidebarItem({
  icon: Icon,
  label,
  description,
  isActive,
  onClick,
}: {
  icon: any;
  label: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all duration-200 group relative",
        isActive
          ? "bg-[#3f3f46] text-white"
          : "text-zinc-400 hover:bg-[#27272a] hover:text-zinc-200"
      )}
    >
      <div
        className={cn(
          "p-2 rounded-md transition-colors",
          isActive
            ? "bg-[#18181b] text-white"
            : "bg-[#18181b] text-zinc-500 group-hover:text-zinc-300 group-hover:bg-[#3f3f46]"
        )}
      >
        <Icon size={24} strokeWidth={2.5} />
      </div>

      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-medium truncate", isActive ? "text-white" : "")}>{label}</p>
        <p
          className={cn(
            "text-[11px] truncate mt-0.5",
            isActive ? "text-zinc-300" : "text-zinc-600 group-hover:text-zinc-500"
          )}
        >
          {description}
        </p>
      </div>
    </button>
  );
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
          Validate now
        </Button>
      </div>

      <div className="px-6 py-5">
        {/* Loading — initial probe in flight (no prior result yet). */}
        {loading && status == null && (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <LuRefreshCw className="w-4 h-4 animate-spin" />
            Validating…
          </div>
        )}

        {/* Not signed in. */}
        {notConnected && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-400">Not signed in.</p>
            <button
              type="button"
              onClick={onOpenIntegrations}
              className="text-sm font-medium hover:underline"
              style={{ color: accent }}
            >
              Connect in Integrations
            </button>
          </div>
        )}

        {/* Invalid / expired — offer a reconnect. */}
        {isInvalid && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <LuCircleX className="w-4 h-4" />
              Token invalid or expired
            </div>
            <Button
              size="sm"
              onClick={() => void reconnect()}
              className="text-white"
              style={{ backgroundColor: accent }}
            >
              Reconnect
            </Button>
          </div>
        )}

        {/* Valid — identity, expiry, and granted scopes. */}
        {isValid && status && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-green-400">
              <LuCircleCheck className="w-4 h-4" />
              Token valid
            </div>

            <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
              <dt className="text-zinc-500">Login</dt>
              <dd className="text-zinc-200 break-all">{status.login ?? "—"}</dd>
              <dt className="text-zinc-500">User ID</dt>
              <dd className="text-zinc-200 break-all tabular-nums">{status.userId ?? "—"}</dd>
              <dt className="text-zinc-500">Expires</dt>
              <dd className="text-zinc-200">{formatExpiry(status.expiresAt)}</dd>
            </dl>

            <div>
              <p className="text-sm text-zinc-500 mb-2">Granted scopes</p>
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
                <p className="text-xs text-zinc-600">No scopes reported.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
