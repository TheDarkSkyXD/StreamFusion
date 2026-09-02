import type { TwitchPlaylistProxySource, UserPreferences } from "@shared/auth-types";

const PLAYBACK_QUERY_PARAMS: Readonly<Record<string, string>> = {
  allow_source: "true",
  allow_audio_only: "true",
  fast_bread: "true",
};

function toHttpUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

export function isTwitchPlaylistProxyTemplate(value: string): boolean {
  const url = toHttpUrl(value);
  return url !== null && (url.pathname.includes("$channel") || url.search.includes("$channel"));
}

export function isTwitchPlaylistProxyMode(
  preferences: Pick<UserPreferences, "twitchPlaylistProxy"> | null | undefined
): boolean {
  return preferences?.twitchPlaylistProxy.enabled === true;
}

export function resolveTwitchPlaylistProxyUrl(
  source: TwitchPlaylistProxySource,
  channelName: string
): string | null {
  const url = toHttpUrl(source.url);
  if (!url || !isTwitchPlaylistProxyTemplate(source.url) || !channelName.trim()) return null;

  const channel = encodeURIComponent(channelName.trim());
  url.pathname = url.pathname.replaceAll("$channel", channel);
  url.search = url.search.replaceAll("$channel", channel);
  if (source.addQueryParams) {
    for (const [key, value] of Object.entries(PLAYBACK_QUERY_PARAMS)) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export function resolveTwitchPlaylistProxyPingUrl(
  source: TwitchPlaylistProxySource
): string | null {
  const url = toHttpUrl(source.url);
  if (!url) return null;
  url.pathname = "/ping";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function getEnabledTwitchPlaylistProxySources(
  sources: readonly TwitchPlaylistProxySource[]
): TwitchPlaylistProxySource[] {
  return sources.filter((source) => source.enabled && isTwitchPlaylistProxyTemplate(source.url));
}

export function moveTwitchPlaylistProxySource(
  sources: readonly TwitchPlaylistProxySource[],
  activeId: string,
  overId: string
): TwitchPlaylistProxySource[] {
  const currentIndex = sources.findIndex((source) => source.id === activeId);
  const nextIndex = sources.findIndex((source) => source.id === overId);
  if (currentIndex < 0 || nextIndex < 0 || currentIndex === nextIndex) return [...sources];

  const ordered = [...sources];
  const [moved] = ordered.splice(currentIndex, 1);
  ordered.splice(nextIndex, 0, moved);
  return ordered;
}

export function isTwitchPlaylistProxyOnlineResponse(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "online" in value &&
    typeof Reflect.get(value, "online") === "boolean"
  );
}
