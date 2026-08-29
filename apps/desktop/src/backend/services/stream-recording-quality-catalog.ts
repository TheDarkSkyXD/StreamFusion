import type { StreamRecordingQuality } from "@shared/stream-recording-types";

function parseAttributeList(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/(?:^|,)([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi)) {
    attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, "");
  }
  return attributes;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function labelVariant(attributes: Record<string, string>, height?: number, fps?: number): string {
  const name = attributes.NAME ?? attributes.VIDEO ?? "";
  if (/source|chunked/i.test(name)) return "Source";
  if (height) return `${height}p${fps && fps >= 50 ? Math.round(fps) : ""}`;
  return name || "Video";
}

function isAudioOnly(attributes: Record<string, string>): boolean {
  const codecs = attributes.CODECS ?? "";
  const name = `${attributes.NAME ?? ""} ${attributes.VIDEO ?? ""} ${attributes.AUDIO ?? ""}`;
  const hasVideoCodec = /(avc|hvc|hev|vp0?9|av01)/i.test(codecs);
  return /audio[_ -]?only/i.test(name) || (!attributes.RESOLUTION && !!codecs && !hasVideoCodec);
}

export function parseStreamRecordingQualityCatalog(
  playlist: string,
  masterUrl: string
): StreamRecordingQuality[] {
  const lines = playlist.split(/\r?\n/).map((line) => line.trim());
  const variants: StreamRecordingQuality[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;
    const attributes = parseAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
    let uri = "";
    for (let uriIndex = index + 1; uriIndex < lines.length; uriIndex += 1) {
      if (!lines[uriIndex] || lines[uriIndex].startsWith("#")) continue;
      uri = lines[uriIndex];
      index = uriIndex;
      break;
    }
    if (!uri || isAudioOnly(attributes)) continue;
    const [widthText, heightText] = (attributes.RESOLUTION ?? "").split("x");
    const width = positiveNumber(widthText);
    const height = positiveNumber(heightText);
    const fps = positiveNumber(attributes["FRAME-RATE"]);
    const bitrate = positiveNumber(attributes["AVERAGE-BANDWIDTH"] ?? attributes.BANDWIDTH);
    const quality = labelVariant(attributes, height, fps);
    variants.push({
      quality,
      url: new URL(uri, masterUrl).toString(),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(fps ? { fps } : {}),
      ...(bitrate ? { bitrate } : {}),
      isSource: quality === "Source",
    });
  }
  return variants;
}

function descendingMetric(left?: number, right?: number): number {
  return (right ?? 0) - (left ?? 0);
}

function metricDistance(value: number | undefined, target: number | undefined): number {
  return value === undefined || target === undefined
    ? Number.MAX_SAFE_INTEGER
    : Math.abs(value - target);
}

export function selectStreamRecordingQuality(
  variants: StreamRecordingQuality[],
  desired: StreamRecordingQuality | null
): StreamRecordingQuality | null {
  if (variants.length === 0) return null;
  const exact = desired
    ? variants.find((variant) => variant.quality.toLowerCase() === desired.quality.toLowerCase())
    : null;
  if (exact) return exact;
  if (!desired || desired.isSource) {
    return [...variants].sort(
      (left, right) =>
        descendingMetric(left.height, right.height) ||
        descendingMetric(left.fps, right.fps) ||
        descendingMetric(left.bitrate, right.bitrate) ||
        left.quality.localeCompare(right.quality)
    )[0];
  }
  return [...variants].sort((left, right) => {
    const heightDistance =
      metricDistance(left.height, desired.height) - metricDistance(right.height, desired.height);
    if (heightDistance) return heightDistance;
    const leftAbove = (left.height ?? Number.POSITIVE_INFINITY) > (desired.height ?? 0);
    const rightAbove = (right.height ?? Number.POSITIVE_INFINITY) > (desired.height ?? 0);
    if (leftAbove !== rightAbove) return leftAbove ? 1 : -1;
    const fpsDistance =
      metricDistance(left.fps, desired.fps) - metricDistance(right.fps, desired.fps);
    if (fpsDistance) return fpsDistance;
    const leftFpsAbove = (left.fps ?? Number.POSITIVE_INFINITY) > (desired.fps ?? 0);
    const rightFpsAbove = (right.fps ?? Number.POSITIVE_INFINITY) > (desired.fps ?? 0);
    if (leftFpsAbove !== rightFpsAbove) return leftFpsAbove ? 1 : -1;
    const bitrateDistance =
      metricDistance(left.bitrate, desired.bitrate) -
      metricDistance(right.bitrate, desired.bitrate);
    if (bitrateDistance) return bitrateDistance;
    const leftBitrateAbove = (left.bitrate ?? Number.POSITIVE_INFINITY) > (desired.bitrate ?? 0);
    const rightBitrateAbove = (right.bitrate ?? Number.POSITIVE_INFINITY) > (desired.bitrate ?? 0);
    if (leftBitrateAbove !== rightBitrateAbove) return leftBitrateAbove ? 1 : -1;
    return left.quality.localeCompare(right.quality);
  })[0];
}

export async function fetchStreamRecordingQualityCatalog({
  masterUrl,
  signal,
  fetchPlaylist,
}: {
  masterUrl: string;
  signal?: AbortSignal;
  fetchPlaylist: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<StreamRecordingQuality[]> {
  const response = await fetchPlaylist(masterUrl, { signal });
  if (!response.ok)
    throw new Error(`Could not load recording quality catalog (${response.status})`);
  const variants = parseStreamRecordingQualityCatalog(await response.text(), masterUrl);
  return variants.length > 0 ? variants : [{ quality: "Source", url: masterUrl, isSource: true }];
}
