export const PRODUCT_SETTINGS_VERSION = 1 as const;

export const THEME_OPTIONS = ["dark"] as const;
export const DENSITY_OPTIONS = ["compact", "comfortable", "spacious"] as const;
export const LANGUAGE_OPTIONS = ["en"] as const;
export const VIDEO_QUALITY_OPTIONS = [
  "auto",
  "highest",
  "1440p",
  "2k",
  "1080p",
  "720p",
  "480p",
  "360p",
  "160p",
] as const;
export const TOKEN_PLAYER_OPTIONS = ["native-exoplayer"] as const;
export const SEEK_INTERVAL_OPTIONS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const;
export const CAROUSEL_INTERVAL_MIN_SEC = 15;
export const CAROUSEL_INTERVAL_MAX_SEC = 120;
export const CAROUSEL_INTERVAL_STEP_SEC = 5;
export const MAX_MULTIVIEW_CAP = 6;
export const DEFAULT_LIVE_SYNC_DURATION_COUNT = 4;
export const DEFAULT_FORWARD_BUFFER_SEC = 15;
export const DEFAULT_MAX_BUFFER_SEC = 30;

export type ThemePreference = (typeof THEME_OPTIONS)[number];
export type DensityPreference = (typeof DENSITY_OPTIONS)[number];
export type LanguagePreference = (typeof LANGUAGE_OPTIONS)[number];
export type VideoQualityPreference = (typeof VIDEO_QUALITY_OPTIONS)[number];
export type TokenPlayerPreference = (typeof TOKEN_PLAYER_OPTIONS)[number];
export type SeekIntervalSeconds = (typeof SEEK_INTERVAL_OPTIONS)[number];

export type ProductPreferences = {
  readonly allowHevc: boolean;
  readonly backgroundQuality: VideoQualityPreference;
  readonly captionsEnabled: boolean;
  readonly carouselSeconds: number;
  readonly density: DensityPreference;
  readonly fastForwardSeconds: SeekIntervalSeconds;
  readonly forwardBufferSec: number;
  readonly language: LanguagePreference;
  readonly liveSyncDurationCount: number;
  readonly lowLatencyMode: boolean;
  readonly maxBufferSec: number;
  readonly multiviewCap: number;
  readonly quality: VideoQualityPreference;
  readonly restoreSession: boolean;
  readonly resumePlayback: boolean;
  readonly rewindSeconds: SeekIntervalSeconds;
  readonly showFullscreen: boolean;
  readonly showQuality: boolean;
  readonly showSpeed: boolean;
  readonly showTheater: boolean;
  readonly showVideoStats: boolean;
  readonly showVolume: boolean;
  readonly theme: ThemePreference;
  readonly tokenPlayer: TokenPlayerPreference;
  readonly version: typeof PRODUCT_SETTINGS_VERSION;
};

export const DEFAULT_PRODUCT_PREFERENCES: ProductPreferences = {
  allowHevc: true,
  backgroundQuality: "360p",
  captionsEnabled: true,
  carouselSeconds: CAROUSEL_INTERVAL_MIN_SEC,
  density: "comfortable",
  fastForwardSeconds: 10,
  forwardBufferSec: DEFAULT_FORWARD_BUFFER_SEC,
  language: "en",
  liveSyncDurationCount: DEFAULT_LIVE_SYNC_DURATION_COUNT,
  lowLatencyMode: false,
  maxBufferSec: DEFAULT_MAX_BUFFER_SEC,
  multiviewCap: MAX_MULTIVIEW_CAP,
  quality: "auto",
  restoreSession: true,
  resumePlayback: false,
  rewindSeconds: 10,
  showFullscreen: true,
  showQuality: true,
  showSpeed: true,
  showTheater: true,
  showVideoStats: true,
  showVolume: true,
  theme: "dark",
  tokenPlayer: "native-exoplayer",
  version: PRODUCT_SETTINGS_VERSION,
};

export type PreferencePatch = Partial<
  Omit<ProductPreferences, "version" | "theme" | "tokenPlayer">
> & {
  readonly language?: string;
  readonly theme?: string;
  readonly tokenPlayer?: string;
};

export type PreferenceApplyResult = {
  readonly preferences: ProductPreferences;
  readonly rejected: readonly string[];
};

export function parseProductPreferences(raw: string | null): ProductPreferences {
  if (raw === null || raw.length === 0) return DEFAULT_PRODUCT_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_PRODUCT_PREFERENCES;
    return applyPreferencePatch(DEFAULT_PRODUCT_PREFERENCES, parsed).preferences;
  } catch {
    return DEFAULT_PRODUCT_PREFERENCES;
  }
}

export function serializeProductPreferences(
  preferences: ProductPreferences,
): string {
  return JSON.stringify(preferences);
}

export function applyPreferencePatch(
  current: ProductPreferences,
  patch: PreferencePatch,
): PreferenceApplyResult {
  const rejected: string[] = [];
  const next = mergePreferencePatch(current, patch, rejected);
  return {
    preferences: {
      ...next,
      maxBufferSec: Math.max(next.forwardBufferSec, next.maxBufferSec),
    },
    rejected,
  };
}

function mergePreferencePatch(
  current: ProductPreferences,
  patch: PreferencePatch,
  rejected: string[],
): ProductPreferences {
  return {
    ...current,
    ...mergeBooleanPreferences(current, patch),
    backgroundQuality: qualityOr(patch.backgroundQuality, current.backgroundQuality),
    carouselSeconds: steppedRangeOr(
      patch.carouselSeconds,
      current.carouselSeconds,
      CAROUSEL_INTERVAL_MIN_SEC,
      CAROUSEL_INTERVAL_MAX_SEC,
      CAROUSEL_INTERVAL_STEP_SEC,
    ),
    density: pickOr(DENSITY_OPTIONS, patch.density, current.density),
    fastForwardSeconds: seekOr(patch.fastForwardSeconds, current.fastForwardSeconds),
    forwardBufferSec: rangeOr(patch.forwardBufferSec, current.forwardBufferSec, 2, 60),
    language: languageOr(patch.language, current.language, rejected),
    liveSyncDurationCount: rangeOr(
      patch.liveSyncDurationCount,
      current.liveSyncDurationCount,
      2,
      12,
    ),
    maxBufferSec: rangeOr(patch.maxBufferSec, current.maxBufferSec, 4, 120),
    multiviewCap: rangeOr(patch.multiviewCap, current.multiviewCap, 1, MAX_MULTIVIEW_CAP),
    quality: qualityOr(patch.quality, current.quality),
    rewindSeconds: seekOr(patch.rewindSeconds, current.rewindSeconds),
    theme: themeOr(patch.theme, current.theme, rejected),
    tokenPlayer: tokenPlayerOr(patch.tokenPlayer, current.tokenPlayer, rejected),
    version: PRODUCT_SETTINGS_VERSION,
  };
}

function mergeBooleanPreferences(
  current: ProductPreferences,
  patch: PreferencePatch,
) {
  return {
    allowHevc: booleanOr(patch.allowHevc, current.allowHevc),
    captionsEnabled: booleanOr(patch.captionsEnabled, current.captionsEnabled),
    lowLatencyMode: booleanOr(patch.lowLatencyMode, current.lowLatencyMode),
    restoreSession: booleanOr(patch.restoreSession, current.restoreSession),
    resumePlayback: booleanOr(patch.resumePlayback, current.resumePlayback),
    showFullscreen: booleanOr(patch.showFullscreen, current.showFullscreen),
    showQuality: booleanOr(patch.showQuality, current.showQuality),
    showSpeed: booleanOr(patch.showSpeed, current.showSpeed),
    showTheater: booleanOr(patch.showTheater, current.showTheater),
    showVideoStats: booleanOr(patch.showVideoStats, current.showVideoStats),
    showVolume: booleanOr(patch.showVolume, current.showVolume),
  };
}

export function nativeColorScheme(_theme?: string): "dark" {
  return "dark";
}

export function densityGapMultiplier(density: DensityPreference): number {
  if (density === "compact") return 0.85;
  if (density === "spacious") return 1.15;
  return 1;
}

function themeOr(
  value: unknown,
  fallback: ThemePreference,
  rejected: string[],
): ThemePreference {
  if (value === undefined) return fallback;
  if (value === "dark") return "dark";
  rejected.push("Dark mode is the only appearance on this build.");
  return fallback;
}

function languageOr(
  value: unknown,
  fallback: LanguagePreference,
  rejected: string[],
): LanguagePreference {
  if (value === undefined) return fallback;
  if (typeof value === "string" && LANGUAGE_OPTIONS.includes(value as LanguagePreference)) {
    return value as LanguagePreference;
  }
  rejected.push("Only English is available on this build.");
  return fallback;
}

function tokenPlayerOr(
  value: unknown,
  fallback: TokenPlayerPreference,
  rejected: string[],
): TokenPlayerPreference {
  if (value === undefined) return fallback;
  if (value === "native-exoplayer") return "native-exoplayer";
  rejected.push("Only the native ExoPlayer session is eligible.");
  return fallback;
}

function qualityOr(
  value: unknown,
  fallback: VideoQualityPreference,
): VideoQualityPreference {
  return pickOr(VIDEO_QUALITY_OPTIONS, value, fallback);
}

function seekOr(value: unknown, fallback: SeekIntervalSeconds): SeekIntervalSeconds {
  return pickOr(SEEK_INTERVAL_OPTIONS, value, fallback);
}

function pickOr<T extends string | number>(
  options: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function rangeOr(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function steppedRangeOr(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  step: number,
): number {
  const bounded = rangeOr(value, fallback, min, max);
  return min + Math.round((bounded - min) / step) * step;
}

function isRecord(value: unknown): value is PreferencePatch {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
