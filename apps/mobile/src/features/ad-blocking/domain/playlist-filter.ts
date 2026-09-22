import type {
  PlaybackFilterMode,
  PlaylistFilterResult,
} from "../capabilities/ad-blocking";

const AD_HOSTS = new Set([
  "d2nvs31859zcd8.cloudfront.net",
  "d2vjef5jvl6bfs.cloudfront.net",
]);

const DATE_RANGE_PATTERNS = [
  "stitched-ad",
  "twitch-stitched-ad",
  "amazon-ad",
  "com.twitch.tv/ad",
  "x-tv-twitch-ad",
];

export function filterTwitchPlaylist(
  playlist: string,
  mode: PlaybackFilterMode,
): PlaylistFilterResult {
  if (mode === "passthrough") {
    return untouched(playlist, "Filtering is off.");
  }
  const adsDetected = playlistHasAds(playlist);
  if (!adsDetected) {
    return untouched(playlist, "No Twitch ad markers in this playlist.");
  }
  if (mode === "canary") {
    return untouched(
      playlist,
      "Canary saw ad markers and kept the original playlist.",
      true,
    );
  }
  // Desktop no-backup path always holdUnsafe after ads (never surgically
  // serve leftover ,live rows). Mobile has no ULW backup orchestrator, so
  // match that: any ad-marked playlist is held without media. Surgical strip
  // previously kept post-DISCONTINUITY ,live commercial-break slates on the
  // weaver host, which painted the Twitch interstitial for ~15s.
  const neutralized = neutralizeTrackingUrls(playlist);
  const held = holdUnsafeMediaPlaylist(neutralized);
  return {
    adsDetected: true,
    applied: true,
    diagnostic:
      "Ads detected; held without media (desktop unsafe-hold, no backup).",
    playlist: held,
  };
}

function untouched(
  playlist: string,
  diagnostic: string,
  adsDetected = false,
): PlaylistFilterResult {
  return { adsDetected, applied: false, diagnostic, playlist };
}

export function playlistHasAds(playlist: string): boolean {
  const text = playlist.toLowerCase();
  if (text.includes("stitched")) return true;
  if (text.includes("amazon|")) return true;
  if (text.includes("x-tv-twitch-ad")) return true;
  return playlist.split(/\r?\n/).some((line) => isAdLine(line));
}

function neutralizeTrackingUrls(playlist: string): string {
  return playlist
    .replace(/(X-TV-TWITCH-AD-URL=")[^"]*(")/g, "$1https://twitch.tv$2")
    .replace(
      /(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")[^"]*(")/g,
      "$1https://twitch.tv$2",
    );
}

const MEDIA_BEARING_TAGS = [
  "#EXTINF",
  "#EXT-X-BYTERANGE",
  "#EXT-X-MAP",
  "#EXT-X-PART",
  "#EXT-X-PRELOAD-HINT",
  "#EXT-X-RENDITION-REPORT",
  "#EXT-X-TWITCH-PREFETCH",
];

/** Desktop-equivalent of holdUnsafeTwitchMediaPlaylist: drop media so the player holds. */
export function holdUnsafeMediaPlaylist(playlist: string): string {
  return playlist
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("#")) return false;
      return !MEDIA_BEARING_TAGS.some((tag) => trimmed.startsWith(tag));
    })
    .join("\n");
}

function isAdLine(line: string): boolean {
  return (
    isAdDateRange(line) ||
    isAdCueOut(line) ||
    isAdCueIn(line) ||
    isScte35(line) ||
    isAdExtInf(line) ||
    isAdSegment(line)
  );
}

function isAdDateRange(line: string): boolean {
  if (!line.startsWith("#EXT-X-DATERANGE:")) return false;
  const lower = line.toLowerCase();
  return DATE_RANGE_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isAdCueOut(line: string): boolean {
  return line.startsWith("#EXT-X-CUE-OUT");
}

function isAdCueIn(line: string): boolean {
  return line.startsWith("#EXT-X-CUE-IN");
}

function isScte35(line: string): boolean {
  return (
    line.startsWith("#EXT-OATCLS-SCTE35:") ||
    line.startsWith("#EXT-X-SCTE35:") ||
    line.includes("SCTE35-OUT=")
  );
}

function isAdExtInf(line: string): boolean {
  if (!line.startsWith("#EXTINF:")) return false;
  const lower = line.toLowerCase();
  return lower.includes("stitched") || lower.includes("amazon|");
}

function isAdSegment(value: string): boolean {
  const candidate = value.trim();
  if (candidate === "" || candidate.startsWith("#")) return false;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (AD_HOSTS.has(host)) return true;
    if (host.endsWith(".cloudfront.net") && path.split("/").includes("ad")) {
      return true;
    }
    if (path.split("/").includes("ad")) return true;
    return path.includes("amazon-ad") || path.includes("stitched-ad");
  } catch {
    return candidate.toLowerCase().includes("stitched-ad");
  }
}
