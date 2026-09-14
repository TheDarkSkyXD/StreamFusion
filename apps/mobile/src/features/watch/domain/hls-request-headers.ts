export type HlsRequestHeaders = Readonly<Record<string, string>>;

const PLAYBACK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function twitchHlsRequestHeaders(): HlsRequestHeaders {
  return {
    Origin: "https://www.twitch.tv",
    Referer: "https://www.twitch.tv/",
    "User-Agent": PLAYBACK_USER_AGENT,
  };
}

export function kickHlsRequestHeaders(): HlsRequestHeaders {
  return {
    Origin: "https://kick.com",
    Referer: "https://kick.com/",
    "User-Agent": PLAYBACK_USER_AGENT,
  };
}
