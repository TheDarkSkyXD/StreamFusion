export interface TwitchRenditionTarget {
  resolution: string;
  frameRate: number;
  bandwidth: number;
  codecs: string;
}

export interface TwitchRendition extends TwitchRenditionTarget {
  url: string;
}

export interface TwitchPlaylistAlignment {
  mediaSequence: number;
  programDateTime: string | null;
}

function parseAttributes(line: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of line.matchAll(/([A-Z-]+)=(?:"([^"]*)"|([^,]*))/g)) {
    attributes[match[1]] = match[2] ?? match[3];
  }
  return attributes;
}

function pixelCount(resolution: string): number {
  const [width, height] = resolution.split("x").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) ? width * height : 0;
}

function resolutionHeight(resolution: string): number {
  const height = Number.parseInt(resolution.split("x")[1] ?? "", 10);
  return Number.isFinite(height) ? height : 0;
}

export function keepTwitchRenditionResolution<T extends TwitchRenditionTarget>(
  candidates: readonly T[],
  target: TwitchRenditionTarget
): T[] {
  return candidates.filter((candidate) => candidate.resolution === target.resolution);
}

/**
 * Keep the active resolution first, followed by the lowest available rendition
 * at or above the preferred 480p fallback floor. A genuine 360p rendition is
 * retained as an emergency ad-only tier when Twitch withholds every clean
 * 480p-or-better identity. 160p is never admitted as backup video.
 */
export function keepTwitchBackupRenditions<T extends TwitchRenditionTarget>(
  candidates: readonly T[],
  target: TwitchRenditionTarget,
  minimumFallbackHeight = 480
): T[] {
  const targetHeight = resolutionHeight(target.resolution);
  const exact =
    targetHeight >= minimumFallbackHeight ? keepTwitchRenditionResolution(candidates, target) : [];
  const fallbackPool = candidates.filter(
    (candidate) =>
      resolutionHeight(candidate.resolution) >= minimumFallbackHeight &&
      candidate.resolution !== target.resolution
  );
  const emergencyPool = candidates.filter((candidate) => {
    const height = resolutionHeight(candidate.resolution);
    return height >= 360 && height < minimumFallbackHeight;
  });

  const nearestFallbackHeight =
    fallbackPool.length > 0
      ? Math.min(...fallbackPool.map((candidate) => resolutionHeight(candidate.resolution)))
      : null;
  const fallback = fallbackPool.filter(
    (candidate) => resolutionHeight(candidate.resolution) === nearestFallbackHeight
  );

  const emergencyHeight =
    emergencyPool.length > 0
      ? Math.max(...emergencyPool.map((candidate) => resolutionHeight(candidate.resolution)))
      : null;
  const emergency = emergencyPool.filter(
    (candidate) => resolutionHeight(candidate.resolution) === emergencyHeight
  );

  return [...exact, ...fallback, ...emergency];
}

export function rankTwitchRenditions(
  masterPlaylist: string,
  target: TwitchRenditionTarget
): TwitchRendition[] {
  const lines = masterPlaylist.replace(/\r/g, "").split("\n");
  const renditions: TwitchRendition[] = [];

  for (let index = 0; index < lines.length - 1; index++) {
    if (!lines[index].startsWith("#EXT-X-STREAM-INF")) continue;

    const attributes = parseAttributes(lines[index]);
    const url = lines[index + 1].trim();
    if (!attributes.RESOLUTION || !url.includes(".m3u8")) continue;

    renditions.push({
      url,
      resolution: attributes.RESOLUTION,
      frameRate: Number.parseFloat(attributes["FRAME-RATE"]) || 30,
      bandwidth: Number.parseInt(attributes.BANDWIDTH, 10) || 0,
      codecs: attributes.CODECS ?? "",
    });
  }

  return rankTwitchRenditionCandidates(renditions, target);
}

export function rankTwitchRenditionCandidates<T extends TwitchRenditionTarget>(
  candidates: readonly T[],
  target: TwitchRenditionTarget
): T[] {
  const targetPixels = pixelCount(target.resolution);
  return [...candidates].sort((left, right) => {
    const leftResolutionMismatch = left.resolution === target.resolution ? 0 : 1;
    const rightResolutionMismatch = right.resolution === target.resolution ? 0 : 1;
    if (leftResolutionMismatch !== rightResolutionMismatch) {
      return leftResolutionMismatch - rightResolutionMismatch;
    }

    const leftPixelCount = pixelCount(left.resolution);
    const rightPixelCount = pixelCount(right.resolution);
    const pixelDifference =
      Math.abs(leftPixelCount - targetPixels) - Math.abs(rightPixelCount - targetPixels);
    if (pixelDifference !== 0) return pixelDifference;
    if (leftPixelCount !== rightPixelCount) return rightPixelCount - leftPixelCount;

    const frameRateDifference =
      Math.abs(left.frameRate - target.frameRate) - Math.abs(right.frameRate - target.frameRate);
    if (frameRateDifference !== 0) return frameRateDifference;

    return (
      Math.abs(left.bandwidth - target.bandwidth) - Math.abs(right.bandwidth - target.bandwidth)
    );
  });
}

function playlistSegments(playlist: string): TwitchPlaylistAlignment[] {
  const lines = playlist.replace(/\r/g, "").split("\n");
  const mediaSequence = Number.parseInt(
    lines.find((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"))?.split(":")[1] ?? "",
    10
  );
  if (!Number.isFinite(mediaSequence)) return [];

  const segments: TwitchPlaylistAlignment[] = [];
  let nextSequence = mediaSequence;
  let programDateTime: string | null = null;
  for (const line of lines) {
    if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
      programDateTime = line.slice("#EXT-X-PROGRAM-DATE-TIME:".length).trim();
    } else if (line.startsWith("#EXTINF:")) {
      segments.push({ mediaSequence: nextSequence, programDateTime });
      nextSequence++;
      programDateTime = null;
    }
  }
  return segments;
}

export function findTwitchPlaylistAlignment(
  activePlaylist: string,
  candidatePlaylist: string
): TwitchPlaylistAlignment | null {
  const activeSegments = playlistSegments(activePlaylist);
  const candidateSegments = playlistSegments(candidatePlaylist);

  const timestampedActiveSegments = activeSegments.filter(
    (segment): segment is TwitchPlaylistAlignment & { programDateTime: string } =>
      segment.programDateTime !== null
  );
  if (timestampedActiveSegments.length > 0) {
    for (const active of timestampedActiveSegments) {
      const candidate = candidateSegments.find(
        (segment) => segment.programDateTime === active.programDateTime
      );
      if (candidate) return active;
    }
    return null;
  }

  for (const active of activeSegments) {
    const candidate = candidateSegments.find(
      (segment) => segment.mediaSequence === active.mediaSequence
    );
    if (!candidate) continue;
    return {
      mediaSequence: active.mediaSequence,
      programDateTime: candidate.programDateTime,
    };
  }
  return null;
}
