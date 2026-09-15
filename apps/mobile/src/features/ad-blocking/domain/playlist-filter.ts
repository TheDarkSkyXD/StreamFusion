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
];

const TWITCH_PREFETCH = "#EXT-X-TWITCH-PREFETCH:";

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
  const stripped = stripAdSegments(playlist);
  if (!hasMediaSegments(stripped)) {
    return untouched(
      playlist,
      "Strip would empty the playlist. Original playlist kept.",
      true,
    );
  }
  return {
    adsDetected: true,
    applied: true,
    diagnostic: "Twitch ad segments were stripped from this playlist.",
    playlist: stripped,
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
  return playlist.split(/\r?\n/).some((line) => isAdLine(line));
}

function stripAdSegments(playlist: string): string {
  const lines = playlist.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; ) {
    const line = lines[index] ?? "";
    const skip = skippedAdLines(line, lines[index + 1] ?? "");
    if (skip > 0) {
      index += skip;
      continue;
    }
    kept.push(line);
    index += 1;
  }
  return kept.join("\n");
}

function skippedAdLines(line: string, nextLine: string): 0 | 1 | 2 {
  if (isAdDateRange(line) || isAdCue(line)) return 1;
  if (line.startsWith(TWITCH_PREFETCH) && isAdSegment(line.slice(TWITCH_PREFETCH.length))) {
    return 1;
  }
  if (line.startsWith("#EXTINF:") && isAdSegment(nextLine)) return 2;
  return 0;
}

function hasMediaSegments(playlist: string): boolean {
  return playlist.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}

function isAdLine(line: string): boolean {
  return isAdDateRange(line) || isAdCue(line) || isAdSegment(line);
}

function isAdDateRange(line: string): boolean {
  if (!line.startsWith("#EXT-X-DATERANGE:")) return false;
  const lower = line.toLowerCase();
  return DATE_RANGE_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isAdCue(line: string): boolean {
  return line.startsWith("#EXT-X-CUE-OUT") || line.startsWith("#EXT-X-CUE-IN");
}

function isAdSegment(value: string): boolean {
  const candidate = value.trim();
  if (candidate === "" || candidate.startsWith("#")) return false;
  try {
    const url = new URL(candidate);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (AD_HOSTS.has(host)) return true;
    return (
      (host.endsWith(".cloudfront.net") && path.split("/").includes("ad")) ||
      path.includes("amazon-ad") ||
      path.includes("stitched-ad")
    );
  } catch {
    return candidate.toLowerCase().includes("stitched-ad");
  }
}
