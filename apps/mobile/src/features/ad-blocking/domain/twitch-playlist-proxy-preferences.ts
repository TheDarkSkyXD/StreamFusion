import type {
  TwitchPlaylistProxyPreferences,
  TwitchPlaylistProxySource,
  TwitchPlaylistProxyView,
} from "../capabilities/twitch-playlist-proxy";

export const DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES: TwitchPlaylistProxyPreferences = {
  enabled: true,
  sources: [
    {
      id: "luminous-eu",
      url: "https://eu.luminous.dev/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "luminous-eu-2",
      url: "https://eu2.luminous.dev/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "luminous-eu-3",
      url: "https://eu3.luminous.dev/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "luminous-asia",
      url: "https://as.luminous.dev/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu",
      url: "https://lb-eu.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu-2",
      url: "https://lb-eu2.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu-3",
      url: "https://lb-eu3.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu-4",
      url: "https://lb-eu4.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-eu-5",
      url: "https://lb-eu5.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: true,
    },
    {
      id: "perfprod-na",
      url: "https://lb-na.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: false,
    },
    {
      id: "perfprod-sa",
      url: "https://lb-sa.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: false,
    },
    {
      id: "perfprod-asia",
      url: "https://lb-as.cdn-perfprod.com/live/$channel",
      enabled: true,
      addQueryParams: false,
    },
  ],
};

export function parseTwitchPlaylistProxyPreferences(
  raw: string | null,
): TwitchPlaylistProxyPreferences {
  if (!raw) return DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<TwitchPlaylistProxyPreferences> & {
      version?: number;
    };
    if (parsed.version !== 1 && parsed.enabled === undefined && !Array.isArray(parsed.sources)) {
      return DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES;
    }
    const sources = Array.isArray(parsed.sources)
      ? parsed.sources.map(normalizeSource).filter((source): source is TwitchPlaylistProxySource => source !== null)
      : DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES.sources;
    return {
      enabled: parsed.enabled === true,
      sources,
    };
  } catch {
    return DEFAULT_TWITCH_PLAYLIST_PROXY_PREFERENCES;
  }
}

export { serializeTwitchPlaylistProxyPreferences } from "../capabilities/twitch-playlist-proxy";

export function composeTwitchPlaylistProxyView(
  preferences: TwitchPlaylistProxyPreferences,
): TwitchPlaylistProxyView {
  const enabledCount = preferences.sources.filter((source) => source.enabled).length;
  return {
    detail: preferences.enabled
      ? `Live Twitch tries ${enabledCount} playlist source${enabledCount === 1 ? "" : "s"} in order, then direct Twitch. Custom strip and canary stay paused.`
      : "Playlist proxy is off. Watch uses direct Twitch and the Ad Blocking method below.",
    enabled: preferences.enabled,
    sources: preferences.sources,
    title: preferences.enabled
      ? "Twitch playlist proxy is on"
      : "Twitch playlist proxy is off",
  };
}

function normalizeSource(value: unknown): TwitchPlaylistProxySource | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (typeof record.url !== "string") return null;
  return {
    addQueryParams: record.addQueryParams !== false,
    enabled: record.enabled !== false,
    id: record.id,
    url: record.url,
  };
}
