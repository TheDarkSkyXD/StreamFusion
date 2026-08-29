export type TwitchPlaylistVerdict = "clean" | "suspected" | "ad";
export type TwitchPlaylistCaptureKind = "classification" | "reported-miss";
export type TwitchPlaylistBaselineComparison = "not-available" | "consistent" | "suspicious";

export type TwitchPlaylistAdReason =
  | "ad-daterange"
  | "ad-host"
  | "bitrate-drop"
  | "cue-out"
  | "discontinuity"
  | "host-transition"
  | "sequence-transition"
  | "scte35"
  | "signifier"
  | "timing-transition";

export interface TwitchPlaylistAdSignal {
  reason: TwitchPlaylistAdReason;
  weight: number;
}

export interface TwitchPlaylistDiagnostic {
  schemaVersion: 1;
  captureKind: TwitchPlaylistCaptureKind;
  fingerprint: string;
  baselineFingerprint?: string;
  baselineComparison: TwitchPlaylistBaselineComparison;
  verdict: TwitchPlaylistVerdict;
  score: number;
  reasons: TwitchPlaylistAdReason[];
  signals: TwitchPlaylistAdSignal[];
  tagTypes: string[];
  hostFingerprints: string[];
  mediaSequence: number | null;
  mediaSequenceDelta: number | null;
  programDateTimeDeltaMs: number | null;
  discontinuityCount: number;
  discontinuityDelta: number | null;
  segmentCount: number;
}

export interface TwitchPlaylistAdDetection {
  hasAds: boolean;
  verdict: TwitchPlaylistVerdict;
  score: number;
  reasons: TwitchPlaylistAdReason[];
  signals: TwitchPlaylistAdSignal[];
  diagnostic: TwitchPlaylistDiagnostic;
}

export interface TwitchPlaylistAdDetectionOptions {
  dateRangePatterns?: readonly string[];
  adSignifiers?: readonly string[];
  useDateRangeDetection?: boolean;
  bitrate?: {
    current: number;
    previous: number;
    dropThreshold: number;
  };
}

interface PlaylistSnapshot {
  fingerprint: string;
  tagTypes: string[];
  hostFingerprints: string[];
  mediaSequence: number | null;
  programDateTimeMs: number | null;
  discontinuityCount: number;
  segmentCount: number;
  segmentReferences: string[];
  lines: string[];
}

export interface TwitchPlaylistAdDetector {
  analyze(
    scopeId: string,
    playlist: string,
    options?: TwitchPlaylistAdDetectionOptions
  ): TwitchPlaylistAdDetection;
  createReportedMissFixture(
    scopeId: string,
    playlist: string,
    options?: TwitchPlaylistAdDetectionOptions
  ): TwitchPlaylistDiagnostic;
  clear(scopeId: string): void;
  clearAll(): void;
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseUrlHost(value: string): string | null {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isKnownAdSegment(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (host === "d2nvs31859zcd8.cloudfront.net" || host === "d2vjef5jvl6bfs.cloudfront.net") {
      return true;
    }
    return (
      (host.endsWith(".cloudfront.net") && path.split("/").includes("ad")) ||
      path.includes("amazon-ad") ||
      path.includes("stitched-ad")
    );
  } catch {
    return false;
  }
}

function parseSegmentReference(line: string): string | null {
  if (line !== "" && !line.startsWith("#")) {
    return line;
  }

  const prefetchPrefix = "#EXT-X-TWITCH-PREFETCH:";
  return line.startsWith(prefetchPrefix) ? line.slice(prefetchPrefix.length) : null;
}

function parseSnapshot(playlist: string): PlaylistSnapshot {
  const lines = playlist
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim());
  const tagTypes = Array.from(
    new Set(
      lines
        .filter((line) => line.startsWith("#"))
        .map((line) => line.split(":", 1)[0])
        .filter((tag) => tag !== "#EXTM3U")
    )
  ).sort();
  const segmentReferences = lines
    .map(parseSegmentReference)
    .filter((value): value is string => value !== null);
  const hosts = segmentReferences.map(parseUrlHost).filter((host): host is string => host !== null);
  const hostFingerprints = Array.from(new Set(hosts.map((host) => fingerprint(host)))).sort();
  const mediaSequenceLine = lines.find((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
  const mediaSequence = mediaSequenceLine
    ? Number.parseInt(mediaSequenceLine.slice(mediaSequenceLine.indexOf(":") + 1), 10)
    : null;
  const programDateTimeLine = lines.find((line) => line.startsWith("#EXT-X-PROGRAM-DATE-TIME:"));
  const parsedProgramDateTime = programDateTimeLine
    ? Date.parse(programDateTimeLine.slice(programDateTimeLine.indexOf(":") + 1))
    : Number.NaN;
  const programDateTimeMs = Number.isFinite(parsedProgramDateTime) ? parsedProgramDateTime : null;
  const discontinuityCount = lines.filter((line) => line === "#EXT-X-DISCONTINUITY").length;
  const segmentCount = lines.filter((line) => line.startsWith("#EXTINF:")).length;
  const structuralValue = JSON.stringify({
    tagTypes,
    hostFingerprints,
    mediaSequence,
    discontinuityCount,
    segmentCount,
    durations: lines
      .filter((line) => line.startsWith("#EXTINF:"))
      .map((line) => line.slice("#EXTINF:".length).split(",", 1)[0]),
  });

  return {
    fingerprint: fingerprint(structuralValue),
    tagTypes,
    hostFingerprints,
    mediaSequence: Number.isFinite(mediaSequence) ? mediaSequence : null,
    programDateTimeMs,
    discontinuityCount,
    segmentCount,
    segmentReferences,
    lines,
  };
}

function delta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

export function fingerprintTwitchPlaylist(playlist: string): TwitchPlaylistDiagnostic {
  const snapshot = parseSnapshot(playlist);
  return {
    schemaVersion: 1,
    captureKind: "classification",
    fingerprint: snapshot.fingerprint,
    baselineComparison: "not-available",
    verdict: "clean",
    score: 0,
    reasons: [],
    signals: [],
    tagTypes: snapshot.tagTypes,
    hostFingerprints: snapshot.hostFingerprints,
    mediaSequence: snapshot.mediaSequence,
    mediaSequenceDelta: null,
    programDateTimeDeltaMs: null,
    discontinuityCount: snapshot.discontinuityCount,
    discontinuityDelta: null,
    segmentCount: snapshot.segmentCount,
  };
}

export function createTwitchPlaylistAdDetector(): TwitchPlaylistAdDetector {
  const cleanBaselines = new Map<string, PlaylistSnapshot>();

  const detector: TwitchPlaylistAdDetector = {
    analyze(scopeId, playlist, options = {}) {
      const snapshot = parseSnapshot(playlist);
      const scopeFingerprint = fingerprint(scopeId);
      const baseline = cleanBaselines.get(scopeFingerprint);
      const signals: TwitchPlaylistAdSignal[] = [];
      if (options.useDateRangeDetection !== false) {
        const dateRangeLines = snapshot.lines.filter((line) =>
          line.startsWith("#EXT-X-DATERANGE:")
        );
        const hasKnownDateRange = dateRangeLines.some(
          (line) =>
            line.includes("X-TV-TWITCH-AD-") ||
            (options.dateRangePatterns ?? []).some((pattern) =>
              line.toLowerCase().includes(pattern.toLowerCase())
            )
        );
        if (hasKnownDateRange) {
          signals.push({ reason: "ad-daterange", weight: 100 });
        }
      }
      if (snapshot.discontinuityCount > 0) {
        signals.push({ reason: "discontinuity", weight: 20 });
      }
      if (
        snapshot.lines.some(
          (line) => line.startsWith("#EXT-X-CUE-OUT") || line.startsWith("#EXT-X-CUE-OUT-CONT")
        )
      ) {
        signals.push({ reason: "cue-out", weight: 100 });
      }
      if (
        snapshot.lines.some(
          (line) =>
            line.startsWith("#EXT-OATCLS-SCTE35:") ||
            line.startsWith("#EXT-X-SCTE35:") ||
            line.includes("SCTE35-OUT=")
        )
      ) {
        signals.push({ reason: "scte35", weight: 100 });
      }
      if (snapshot.segmentReferences.some(isKnownAdSegment)) {
        signals.push({ reason: "ad-host", weight: 100 });
      }
      const contextualLines = snapshot.lines.filter(
        (line) =>
          line.startsWith("#EXTINF:") ||
          line.startsWith("#EXT-X-DATERANGE:") ||
          (line !== "" && !line.startsWith("#"))
      );
      if (
        contextualLines.some((line) =>
          (options.adSignifiers ?? []).some((signifier) =>
            line.toLowerCase().includes(signifier.toLowerCase())
          )
        )
      ) {
        signals.push({ reason: "signifier", weight: 100 });
      }
      if (options.bitrate) {
        const ratio = options.bitrate.current / options.bitrate.previous;
        if (Number.isFinite(ratio) && ratio < 1 - options.bitrate.dropThreshold) {
          signals.push({ reason: "bitrate-drop", weight: 40 });
        }
      }
      if (baseline) {
        const hasSharedHost = snapshot.hostFingerprints.some((host) =>
          baseline.hostFingerprints.includes(host)
        );
        if (
          snapshot.hostFingerprints.length > 0 &&
          baseline.hostFingerprints.length > 0 &&
          !hasSharedHost
        ) {
          signals.push({ reason: "host-transition", weight: 30 });
        }

        const sequenceDelta = delta(snapshot.mediaSequence, baseline.mediaSequence);
        if (
          sequenceDelta !== null &&
          (sequenceDelta < 0 || sequenceDelta > baseline.segmentCount + 2)
        ) {
          signals.push({ reason: "sequence-transition", weight: 30 });
        }

        const timeDelta = delta(snapshot.programDateTimeMs, baseline.programDateTimeMs);
        if (
          timeDelta !== null &&
          (timeDelta < 0 || timeDelta > (baseline.segmentCount + 2) * 2000)
        ) {
          signals.push({ reason: "timing-transition", weight: 30 });
        }
      }
      const score = signals.reduce((total, signal) => total + signal.weight, 0);
      const verdict: TwitchPlaylistVerdict =
        score >= 100 ? "ad" : score >= 30 ? "suspected" : "clean";
      const reasons = signals.map((signal) => signal.reason);
      const hasSuspiciousTransition = reasons.some(
        (reason) =>
          reason === "host-transition" ||
          reason === "sequence-transition" ||
          reason === "timing-transition"
      );
      const diagnostic: TwitchPlaylistDiagnostic = {
        ...fingerprintTwitchPlaylist(playlist),
        baselineFingerprint: baseline?.fingerprint,
        baselineComparison: baseline
          ? hasSuspiciousTransition
            ? "suspicious"
            : "consistent"
          : "not-available",
        verdict,
        score,
        reasons,
        signals,
        mediaSequenceDelta: baseline ? delta(snapshot.mediaSequence, baseline.mediaSequence) : null,
        programDateTimeDeltaMs: baseline
          ? delta(snapshot.programDateTimeMs, baseline.programDateTimeMs)
          : null,
        discontinuityDelta: baseline
          ? snapshot.discontinuityCount - baseline.discontinuityCount
          : null,
      };

      if (verdict === "clean") {
        cleanBaselines.set(scopeFingerprint, { ...snapshot, lines: [] });
      }
      return {
        hasAds: verdict === "ad",
        verdict,
        score,
        reasons,
        signals,
        diagnostic,
      };
    },
    createReportedMissFixture(scopeId, playlist, options = {}) {
      const scopeFingerprint = fingerprint(scopeId);
      const previousBaseline = cleanBaselines.get(scopeFingerprint);
      const diagnostic = detector.analyze(scopeId, playlist, options).diagnostic;

      if (previousBaseline) {
        cleanBaselines.set(scopeFingerprint, previousBaseline);
      } else {
        cleanBaselines.delete(scopeFingerprint);
      }

      return { ...diagnostic, captureKind: "reported-miss" };
    },
    clear(scopeId) {
      cleanBaselines.delete(fingerprint(scopeId));
    },
    clearAll() {
      cleanBaselines.clear();
    },
  };

  return detector;
}
