import type {
  StreamRecordingArtifactIdentity,
  StreamRecordingGap,
  StreamRecordingJournalV2,
  StreamRecordingNotice,
  StreamRecordingQuality,
  StreamRecordingRecoveryExhaustion,
  StreamRecordingSection,
  StreamRecordingSession,
  StreamRecordingSnapshot,
  StreamRecordingStatus,
} from "@shared/stream-recording-types";
import { storageService } from "./storage-service";
import {
  isOwnedRecordingOutput,
  isOwnedRecordingSection,
  isSymbolicLink as isSymbolicLinkOnDisk,
  normalizeRecordingDestination,
} from "./stream-recording-paths";

export interface StreamRecordingJournalStorage {
  getStreamRecordingJournal(): unknown;
  saveStreamRecordingJournal(journal: StreamRecordingJournalV2): void;
}

export interface StreamRecordingSessionStore {
  getJournal(): StreamRecordingJournalV2;
  getSnapshot(): StreamRecordingSnapshot;
  saveSession(session: StreamRecordingSession): void;
  clearSession(): void;
  setNotice(notice: StreamRecordingNotice | null): void;
  settle(sessionId: string, notice: StreamRecordingNotice): boolean;
  dismissNotice(sessionId: string): boolean;
  subscribe(listener: (snapshot: StreamRecordingSnapshot) => void): () => void;
}

const EMPTY_JOURNAL: StreamRecordingJournalV2 = { version: 2, state: "empty", session: null };
const SESSION_STATUSES = new Set<StreamRecordingStatus>([
  "preparing",
  "recording",
  "paused",
  "reconnecting",
  "finalizing",
  "interrupted",
]);
const GAP_REASONS = new Set<StreamRecordingGap["reason"]>(["paused", "reconnect", "restart"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return stringValue(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseQuality(value: unknown): StreamRecordingQuality | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const quality = stringValue(value.quality);
  if (!quality) return undefined;
  const parsed: StreamRecordingQuality = { quality };
  for (const key of ["width", "height", "fps", "bitrate"] as const) {
    if (value[key] === undefined) continue;
    const number = finiteNumber(value[key]);
    if (number === undefined || number < 0) return undefined;
    parsed[key] = number;
  }
  if (value.isSource !== undefined) {
    if (typeof value.isSource !== "boolean") return undefined;
    parsed.isSource = value.isSource;
  }
  return parsed;
}

function parseArtifactIdentity(value: unknown): StreamRecordingArtifactIdentity | null {
  if (!isRecord(value)) return null;
  const digest = stringValue(value.digest);
  const size = finiteNumber(value.size);
  if (value.algorithm !== "sha256" || !digest || size === undefined || size < 0) return null;
  return { algorithm: "sha256", digest, size };
}

function parseRecoveryExhaustion(
  value: unknown,
  destinationPath: string,
  isSymbolicLink: (filePath: string) => boolean
): StreamRecordingRecoveryExhaustion | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const error = stringValue(value.error);
  if (!error) return undefined;
  if (value.state === "finalizing") return { state: "finalizing", error };
  if (value.state !== "commit-intent" && value.state !== "pending-probe") return undefined;
  const outputPath = stringValue(value.outputPath);
  const artifactIdentity = parseArtifactIdentity(value.artifactIdentity);
  if (
    !outputPath ||
    (value.outputFormat !== "mp4" && value.outputFormat !== "ts") ||
    typeof value.usedFallback !== "boolean" ||
    !artifactIdentity ||
    !isOwnedRecordingOutput(destinationPath, outputPath, value.outputFormat, value.usedFallback) ||
    isSymbolicLink(outputPath)
  ) {
    return undefined;
  }
  return {
    state: value.state,
    error,
    outputPath,
    outputFormat: value.outputFormat,
    usedFallback: value.usedFallback,
    artifactIdentity,
  };
}

function parseSection(value: unknown): StreamRecordingSection | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const sectionPath = stringValue(value.path);
  const startedAt = stringValue(value.startedAt);
  const endedAt = optionalString(value.endedAt);
  if (
    !id ||
    !sectionPath ||
    !/\.ts$/i.test(sectionPath) ||
    !startedAt ||
    (value.endedAt !== undefined && endedAt === undefined)
  ) {
    return null;
  }
  return { id, path: sectionPath, startedAt, ...(endedAt ? { endedAt } : {}) };
}

function parseGap(value: unknown): StreamRecordingGap | null {
  if (!isRecord(value)) return null;
  const startedAt = stringValue(value.startedAt);
  const endedAt = optionalString(value.endedAt);
  if (
    !startedAt ||
    (value.endedAt !== undefined && endedAt === undefined) ||
    typeof value.reason !== "string" ||
    !GAP_REASONS.has(value.reason as StreamRecordingGap["reason"])
  ) {
    return null;
  }
  return {
    startedAt,
    ...(endedAt ? { endedAt } : {}),
    reason: value.reason as StreamRecordingGap["reason"],
  };
}

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseSession(
  value: unknown,
  isSymbolicLink: (filePath: string) => boolean
): StreamRecordingSession | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const streamId = optionalString(value.streamId);
  const channelName = stringValue(value.channelName);
  const title = stringValue(value.title);
  const rawDestinationPath = stringValue(value.destinationPath);
  const destinationPath = rawDestinationPath
    ? normalizeRecordingDestination(rawDestinationPath)
    : null;
  const createdAt = stringValue(value.createdAt);
  const updatedAt = stringValue(value.updatedAt);
  const capturedDurationSeconds = finiteNumber(value.capturedDurationSeconds);
  const qualityLabel = optionalString(value.qualityLabel);
  if (
    !id ||
    (value.streamId !== undefined && streamId === undefined) ||
    (value.platform !== "twitch" && value.platform !== "kick") ||
    !channelName ||
    !title ||
    typeof value.status !== "string" ||
    !SESSION_STATUSES.has(value.status as StreamRecordingStatus) ||
    !destinationPath ||
    qualityLabel === undefined ||
    capturedDurationSeconds === undefined ||
    capturedDurationSeconds < 0 ||
    !Array.isArray(value.sections) ||
    value.sections.length === 0 ||
    !Array.isArray(value.gaps) ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }
  const createdTimestamp = parseTimestamp(createdAt);
  const updatedTimestamp = parseTimestamp(updatedAt);
  if (
    createdTimestamp === null ||
    updatedTimestamp === null ||
    createdTimestamp > updatedTimestamp
  ) {
    return null;
  }
  const sections = value.sections.map(parseSection);
  const gaps = value.gaps.map(parseGap);
  if (sections.some((section) => !section) || gaps.some((gap) => !gap)) return null;
  const parsedSections = sections as StreamRecordingSection[];
  let previousSectionBoundary = createdTimestamp;
  for (const [index, section] of parsedSections.entries()) {
    const startedTimestamp = parseTimestamp(section.startedAt);
    const endedTimestamp = section.endedAt ? parseTimestamp(section.endedAt) : null;
    if (
      !isOwnedRecordingSection(destinationPath, id, index + 1, section) ||
      isSymbolicLink(section.path) ||
      startedTimestamp === null ||
      startedTimestamp < previousSectionBoundary ||
      startedTimestamp > updatedTimestamp ||
      (section.endedAt &&
        (endedTimestamp === null ||
          endedTimestamp < startedTimestamp ||
          endedTimestamp > updatedTimestamp)) ||
      (!section.endedAt && index < parsedSections.length - 1)
    ) {
      return null;
    }
    previousSectionBoundary = endedTimestamp ?? startedTimestamp;
  }
  const desiredQuality = parseQuality(value.desiredQuality);
  const currentQuality = parseQuality(value.currentQuality);
  const recoveryExhaustion = parseRecoveryExhaustion(
    value.recoveryExhaustion,
    destinationPath,
    isSymbolicLink
  );
  if (
    (value.desiredQuality !== undefined && desiredQuality === undefined) ||
    (value.currentQuality !== undefined && currentQuality === undefined) ||
    (value.recoveryExhaustion !== undefined && recoveryExhaustion === undefined)
  ) {
    return null;
  }
  const session: StreamRecordingSession = {
    id,
    ...(streamId ? { streamId } : {}),
    platform: value.platform,
    channelName,
    title,
    status: value.status as StreamRecordingStatus,
    destinationPath,
    qualityLabel,
    capturedDurationSeconds,
    sections: parsedSections,
    gaps: gaps as StreamRecordingGap[],
    createdAt,
    updatedAt,
  };
  if (desiredQuality !== undefined) session.desiredQuality = desiredQuality;
  if (currentQuality !== undefined) session.currentQuality = currentQuality;
  if (recoveryExhaustion !== undefined) session.recoveryExhaustion = recoveryExhaustion;
  if (isRecord(value.qualityChange)) {
    const revision = finiteNumber(value.qualityChange.revision);
    const fromQuality = stringValue(value.qualityChange.fromQuality);
    const toQuality = stringValue(value.qualityChange.toQuality);
    if (revision === undefined || revision < 0 || !fromQuality || !toQuality) return null;
    session.qualityChange = { revision, fromQuality, toQuality };
  } else if (value.qualityChange === null) session.qualityChange = null;
  else if (value.qualityChange !== undefined) return null;
  if (typeof value.partial === "boolean") session.partial = value.partial;
  else if (value.partial !== undefined) return null;
  const statusMessage = optionalString(value.statusMessage);
  if (value.statusMessage !== undefined && statusMessage === undefined) return null;
  if (statusMessage !== undefined) session.statusMessage = statusMessage;
  if (value.outputFormat === "mp4" || value.outputFormat === "ts" || value.outputFormat === null) {
    session.outputFormat = value.outputFormat;
  } else if (value.outputFormat !== undefined) return null;
  const committedOutputPath = optionalString(value.committedOutputPath);
  if (value.committedOutputPath !== undefined && committedOutputPath === undefined) return null;
  if (committedOutputPath !== undefined) session.committedOutputPath = committedOutputPath;
  if (value.committedArtifactIdentity !== undefined) {
    if (value.committedArtifactIdentity === null) session.committedArtifactIdentity = null;
    else {
      const identity = parseArtifactIdentity(value.committedArtifactIdentity);
      if (!identity) return null;
      session.committedArtifactIdentity = identity;
    }
  }
  if (typeof value.usedFallback === "boolean") session.usedFallback = value.usedFallback;
  else if (value.usedFallback !== undefined) return null;
  if (committedOutputPath) {
    if (
      (session.outputFormat !== "mp4" && session.outputFormat !== "ts") ||
      !session.committedArtifactIdentity ||
      typeof session.usedFallback !== "boolean" ||
      !isOwnedRecordingOutput(
        destinationPath,
        committedOutputPath,
        session.outputFormat,
        session.usedFallback
      ) ||
      isSymbolicLink(committedOutputPath)
    ) {
      return null;
    }
  }
  let previousGapBoundary = createdTimestamp;
  for (const [index, gap] of session.gaps.entries()) {
    const startedTimestamp = parseTimestamp(gap.startedAt);
    const endedTimestamp = gap.endedAt ? parseTimestamp(gap.endedAt) : null;
    if (
      startedTimestamp === null ||
      startedTimestamp < previousGapBoundary ||
      startedTimestamp > updatedTimestamp ||
      (gap.endedAt &&
        (endedTimestamp === null ||
          endedTimestamp < startedTimestamp ||
          endedTimestamp > updatedTimestamp)) ||
      (!gap.endedAt && index < session.gaps.length - 1)
    ) {
      return null;
    }
    previousGapBoundary = endedTimestamp ?? startedTimestamp;
  }
  return session;
}

function hydrateJournal(
  input: unknown,
  isSymbolicLink: (filePath: string) => boolean
): StreamRecordingJournalV2 {
  if (!isRecord(input)) return EMPTY_JOURNAL;
  if (input.version === 2 && input.state === "empty" && input.session === null) {
    return EMPTY_JOURNAL;
  }
  const isV1 = input.version === 1 && "session" in input;
  const isV2Session =
    input.version === 2 && (input.state === "active" || input.state === "interrupted");
  if (!isV1 && !isV2Session) return EMPTY_JOURNAL;
  if (input.session === null) return EMPTY_JOURNAL;
  const session = parseSession(input.session, isSymbolicLink);
  if (!session) return EMPTY_JOURNAL;
  const hasOpenRestartGap = session.gaps.some((gap) => gap.reason === "restart" && !gap.endedAt);
  const closedPreRestartGaps = session.gaps.map((gap) =>
    gap.endedAt || gap.reason === "restart" ? gap : { ...gap, endedAt: session.updatedAt }
  );
  const interrupted: StreamRecordingSession = {
    ...session,
    status: "interrupted",
    partial: true,
    statusMessage: "Recording interrupted when StreamFusion closed",
    gaps: hasOpenRestartGap
      ? session.gaps
      : [...closedPreRestartGaps, { startedAt: session.updatedAt, reason: "restart" }],
  };
  return { version: 2, state: "interrupted", session: interrupted };
}

function toSnapshot(
  journal: StreamRecordingJournalV2,
  notice: StreamRecordingNotice | null
): StreamRecordingSnapshot {
  const session = journal.session;
  const hasFinalizationCheckpoint = Boolean(
    session &&
      (session.recoveryExhaustion?.state === "commit-intent" ||
        session.recoveryExhaustion?.state === "pending-probe" ||
        session.committedOutputPath ||
        session.committedArtifactIdentity)
  );
  const recoveryResumeUnavailable = Boolean(
    session?.status === "interrupted" && (!session.streamId || hasFinalizationCheckpoint)
  );
  return {
    active: session
      ? {
          sessionId: session.id,
          platform: session.platform,
          channelName: session.channelName,
          title: session.title,
          status: session.status,
          qualityLabel: session.qualityLabel,
          desiredQualityLabel: session.desiredQuality?.quality ?? session.qualityLabel,
          currentQualityLabel: session.currentQuality?.quality ?? session.qualityLabel,
          qualityChange: session.qualityChange ?? null,
          recoveryExhaustionState: session.recoveryExhaustion?.state ?? null,
          ...(session.status === "interrupted"
            ? {
                recoveryFinalizeOnly: recoveryResumeUnavailable,
                recoveryResumeEligible: !recoveryResumeUnavailable,
                ...(recoveryResumeUnavailable
                  ? {
                      recoveryResumeUnavailableReason: hasFinalizationCheckpoint
                        ? ("finalization-checkpoint" as const)
                        : ("missing-stream-identity" as const),
                    }
                  : {}),
              }
            : {}),
          capturedDurationSeconds: session.capturedDurationSeconds,
          gapCount: session.gaps.length,
          hasOpenGap: session.gaps.some((gap) => !gap.endedAt),
          openGapStartedAt: session.gaps.findLast((gap) => !gap.endedAt)?.startedAt ?? null,
          statusMessage: session.statusMessage ?? null,
          ...(session.partial !== undefined ? { partial: session.partial } : {}),
        }
      : null,
    notice,
  };
}

function journalForSession(
  session: StreamRecordingSession,
  isSymbolicLink: (filePath: string) => boolean
): StreamRecordingJournalV2 {
  const safeSession = parseSession(session, isSymbolicLink);
  if (!safeSession) throw new Error("Recording journal ownership or timing is invalid");
  return {
    version: 2,
    state: safeSession.status === "interrupted" ? "interrupted" : "active",
    session: safeSession,
  };
}

export function createStreamRecordingSessionStore({
  storage,
  isSymbolicLink = isSymbolicLinkOnDisk,
}: {
  storage: StreamRecordingJournalStorage;
  isSymbolicLink?: (filePath: string) => boolean;
}): StreamRecordingSessionStore {
  const listeners = new Set<(snapshot: StreamRecordingSnapshot) => void>();
  let journal = hydrateJournal(storage.getStreamRecordingJournal(), isSymbolicLink);
  let notice: StreamRecordingNotice | null = null;

  function emit(): void {
    const snapshot = toSnapshot(journal, notice);
    for (const listener of listeners) listener(snapshot);
  }

  function save(next: StreamRecordingJournalV2): void {
    storage.saveStreamRecordingJournal(next);
    journal = next;
    emit();
  }

  return {
    getJournal: () => journal,
    getSnapshot: () => toSnapshot(journal, notice),
    saveSession: (session) => save(journalForSession(session, isSymbolicLink)),
    clearSession: () => save(EMPTY_JOURNAL),
    setNotice: (nextNotice) => {
      notice = nextNotice;
      emit();
    },
    settle: (sessionId, nextNotice) => {
      if (journal.session?.id !== sessionId || nextNotice.sessionId !== sessionId) return false;
      storage.saveStreamRecordingJournal(EMPTY_JOURNAL);
      journal = EMPTY_JOURNAL;
      notice = nextNotice;
      emit();
      return true;
    },
    dismissNotice: (sessionId) => {
      if (notice?.sessionId !== sessionId) return false;
      notice = null;
      emit();
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let streamRecordingSessionStore: StreamRecordingSessionStore | null = null;

export function getStreamRecordingSessionStore(): StreamRecordingSessionStore {
  if (!streamRecordingSessionStore) {
    streamRecordingSessionStore = createStreamRecordingSessionStore({ storage: storageService });
  }
  return streamRecordingSessionStore;
}
