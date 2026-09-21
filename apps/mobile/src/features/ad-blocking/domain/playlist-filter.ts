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
  if (text.includes("amazon|")) return true;
  return playlist.split(/\r?\n/).some((line) => isAdLine(line));
}

function stripAdSegments(playlist: string): string {
  const lines = playlist.replace(/\r/g, "").split("\n");
  const kept: string[] = [];
  let insideDateRangeAd = false;
  let insideCueAd = false;
  for (let index = 0; index < lines.length; ) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";

    if (isAdDateRange(line)) {
      insideDateRangeAd = true;
      index += 1;
      continue;
    }
    if (isAdCueOut(line)) {
      insideCueAd = true;
      index += 1;
      continue;
    }
    if (isAdCueIn(line)) {
      insideCueAd = false;
      insideDateRangeAd = false;
      index += 1;
      continue;
    }
    if (line.startsWith("#EXT-X-DISCONTINUITY")) {
      insideDateRangeAd = false;
      kept.push(line);
      index += 1;
      continue;
    }
    if (
      line.startsWith(TWITCH_PREFETCH) &&
      isAdSegment(line.slice(TWITCH_PREFETCH.length))
    ) {
      index += 1;
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      const live = line.toLowerCase().includes(",live");
      const adByUrl = isAdSegment(nextLine);
      const adByInf = isAdExtInf(line);
      const adByCue = insideCueAd && !live;
      const adByRange = insideDateRangeAd && (adByUrl || adByInf);
      if (adByUrl || adByInf || adByCue || adByRange) {
        index += isMediaUri(nextLine) ? 2 : 1;
        continue;
      }
      if (insideDateRangeAd && !adByUrl && !adByInf) {
        insideDateRangeAd = false;
      }
      kept.push(line);
      index += 1;
      continue;
    }
    kept.push(line);
    index += 1;
  }
  return kept.join("\n");
}

function hasMediaSegments(playlist: string): boolean {
  return playlist.split("\n").some((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}

function isMediaUri(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== "" && !trimmed.startsWith("#");
}

function isAdLine(line: string): boolean {
  return (
    isAdDateRange(line) ||
    isAdCueOut(line) ||
    isAdCueIn(line) ||
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
    if (path.split("/").includes("ad")) return true;
    return path.includes("amazon-ad") || path.includes("stitched-ad");
  } catch {
    return candidate.toLowerCase().includes("stitched-ad");
  }
}
