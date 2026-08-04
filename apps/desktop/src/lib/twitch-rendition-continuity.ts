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

export function keepTwitchRenditionResolution<T extends TwitchRenditionTarget>(
  candidates: readonly T[],
  target: TwitchRenditionTarget
): T[] {
  return candidates.filter((candidate) => candidate.resolution === target.resolution);
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
