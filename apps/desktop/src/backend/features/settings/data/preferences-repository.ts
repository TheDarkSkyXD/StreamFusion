import {
  type BufferPreferences,
  type CaptionPreferences,
  DEFAULT_CAPTION_PREFERENCES,
  DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  type TwitchPlaylistProxyPreferences,
  type TwitchPlaylistProxySource,
  type UserPreferences,
} from "@shared/auth-types";
import { resolveDisplayLanguage } from "@shared/display-language";
import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES as DEFAULT_NOTIFICATION_PREFERENCES,
  type LiveNotificationPreferences as NotificationPreferences,
} from "@streamfusion/core/follows";

import { storageService, type StorageService } from "@backend/services/storage-service";
import { defaults } from "./persistent-store-schema";
const LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES: BufferPreferences = {
  lowLatencyMode: true,
  liveSyncDurationCount: 2,
  maxBufferLengthSec: 15,
  maxMaxBufferLengthSec: 30,
};

function isLegacyLatencyFirstBufferPreferences(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const buffer = value as Partial<BufferPreferences>;
  return (
    buffer.lowLatencyMode === LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES.lowLatencyMode &&
    buffer.liveSyncDurationCount ===
      LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES.liveSyncDurationCount &&
    buffer.maxBufferLengthSec === LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES.maxBufferLengthSec &&
    buffer.maxMaxBufferLengthSec === LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES.maxMaxBufferLengthSec
  );
}

function normalizeCaptionPreferences(value: unknown): CaptionPreferences {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const preferredLanguage = stored.preferredLanguage;
  const localModelId = stored.localModelId;
  const textSizePercent = stored.textSizePercent;
  const backgroundOpacityPercent = stored.backgroundOpacityPercent;

  return {
    enabled:
      typeof stored.enabled === "boolean" ? stored.enabled : DEFAULT_CAPTION_PREFERENCES.enabled,
    source:
      stored.source === "platform" || stored.source === "local"
        ? stored.source
        : DEFAULT_CAPTION_PREFERENCES.source,
    preferredLanguage:
      preferredLanguage === null ||
      (typeof preferredLanguage === "string" &&
        /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(preferredLanguage))
        ? preferredLanguage
        : DEFAULT_CAPTION_PREFERENCES.preferredLanguage,
    localModelId:
      localModelId === null ||
      (typeof localModelId === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(localModelId))
        ? localModelId
        : DEFAULT_CAPTION_PREFERENCES.localModelId,
    textSizePercent:
      typeof textSizePercent === "number" &&
      Number.isFinite(textSizePercent) &&
      textSizePercent >= 75 &&
      textSizePercent <= 200
        ? textSizePercent
        : DEFAULT_CAPTION_PREFERENCES.textSizePercent,
    backgroundOpacityPercent:
      typeof backgroundOpacityPercent === "number" &&
      Number.isFinite(backgroundOpacityPercent) &&
      backgroundOpacityPercent >= 0 &&
      backgroundOpacityPercent <= 100
        ? backgroundOpacityPercent
        : DEFAULT_CAPTION_PREFERENCES.backgroundOpacityPercent,
  };
}

function normalizeTwitchPlaylistProxyPreferences(value: unknown): TwitchPlaylistProxyPreferences {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!stored) {
    return {
      enabled: DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES.enabled,
      sources: DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES.sources.map((source) => ({ ...source })),
    };
  }

  const storedSources = Array.isArray(stored.sources) ? stored.sources : [];
  const seenIds = new Set<string>();
  const sources: TwitchPlaylistProxySource[] = [];
  for (const candidate of storedSources) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = candidate as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    const url = typeof source.url === "string" ? source.url.trim() : "";
    if (!id || !url || seenIds.has(id)) continue;
    seenIds.add(id);
    sources.push({
      id,
      url,
      enabled: typeof source.enabled === "boolean" ? source.enabled : true,
      addQueryParams: typeof source.addQueryParams === "boolean" ? source.addQueryParams : false,
    });
  }

  return {
    enabled:
      typeof stored.enabled === "boolean"
        ? stored.enabled
        : DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES.enabled,
    sources,
  };
}

function hydratePreferences(stored: Partial<UserPreferences>): UserPreferences {
  const notificationPreferences: NotificationPreferences = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(stored.notifications ?? {}),
    perChannelNotifications: {
      ...DEFAULT_NOTIFICATION_PREFERENCES.perChannelNotifications,
      ...(stored.notifications?.perChannelNotifications ?? {}),
    },
  };
  const hydrated = {
    ...DEFAULT_USER_PREFERENCES,
    ...stored,
    notifications: notificationPreferences,
    chatDisplay: {
      ...DEFAULT_USER_PREFERENCES.chatDisplay,
      ...(stored.chatDisplay ?? {}),
    },
    captions: normalizeCaptionPreferences(stored.captions),
    twitchPlaylistProxy: normalizeTwitchPlaylistProxyPreferences(stored.twitchPlaylistProxy),
    language: resolveDisplayLanguage(stored.language),
  };
  if (isLegacyLatencyFirstBufferPreferences(hydrated.buffer)) {
    return { ...hydrated, buffer: DEFAULT_USER_PREFERENCES.buffer };
  }
  return hydrated;
}

export class PreferencesRepository {
  private readonly preferenceListeners = new Set<(preferences: UserPreferences) => void>();
  constructor(private readonly driver: StorageService = storageService) {}
  private get storeInstance() {
    return this.driver.getStore();
  }
  /**
   * Get all preferences. Merges the stored value with `DEFAULT_USER_PREFERENCES`
   * so any preference field added in a later version (e.g. `predictions` in
   * the viewer-prediction widget release) hydrates with its default for users
   * whose persisted state predates the field. Shallow merge at the top level
   * is sufficient — every preference subkey is its own object with its own
   * defaults that the original creators of those subkeys are responsible for.
   */
  getPreferences(): UserPreferences {
    const stored = this.storeInstance.get("preferences");
    if (!stored) return defaults.preferences;
    return hydratePreferences(stored);
  }

  /**
   * Update preferences (partial update)
   */
  updatePreferences(updates: Partial<UserPreferences>): UserPreferences {
    const current = this.getPreferences();
    const normalizedUpdates = {
      ...updates,
      ...(updates.language !== undefined
        ? { language: resolveDisplayLanguage(updates.language) }
        : {}),
      ...(updates.captions ? { captions: normalizeCaptionPreferences(updates.captions) } : {}),
      ...(updates.twitchPlaylistProxy
        ? {
            twitchPlaylistProxy: normalizeTwitchPlaylistProxyPreferences(
              updates.twitchPlaylistProxy
            ),
          }
        : {}),
    };
    const updated = { ...current, ...normalizedUpdates };
    this.storeInstance.set("preferences", updated);
    for (const listener of this.preferenceListeners) listener(updated);
    return updated;
  }

  onPreferencesChanged(listener: (preferences: UserPreferences) => void): () => void {
    this.preferenceListeners.add(listener);
    return () => this.preferenceListeners.delete(listener);
  }

  /**
   * Reset preferences to defaults
   */
  resetPreferences(): void {
    this.storeInstance.set("preferences", DEFAULT_USER_PREFERENCES);
    for (const listener of this.preferenceListeners) listener(DEFAULT_USER_PREFERENCES);
  }
}

export const preferencesRepository = new PreferencesRepository();
