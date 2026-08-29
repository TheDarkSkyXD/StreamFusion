import { sleep as defaultSleep } from "@shared/utils/sleep";
import type {
  ActiveStreamRecording,
  StreamRecordingArtifactIdentity,
  StreamRecordingGap,
  StreamRecordingQuality,
  StreamRecordingRecoveryActionResult,
  StreamRecordingRecoveryExhaustion,
  StreamRecordingRequest,
  StreamRecordingSection,
  StreamRecordingSession,
  StreamRecordingSnapshot,
  StreamRecordingStartResult,
} from "@shared/stream-recording-types";
import {
  createStreamRecordingArtifactProbe,
  type StreamRecordingArtifactProbe,
} from "./stream-recording-artifact-probe";
import {
  createStreamRecordingOutcomeCoordinator,
  type StreamRecordingOutcomeCoordinator,
} from "./stream-recording-outcome-coordinator";
import {
  createOwnedRecordingSectionPath,
  isOwnedRecordingOutput,
  isRecordingSectionAvailable as defaultIsRecordingSectionAvailable,
  isOwnedRecordingSection,
} from "./stream-recording-paths";
import { selectStreamRecordingQuality } from "./stream-recording-quality-catalog";
import {
  cleanupRecordingSectionPaths,
  createStreamRecordingSectionFinalizer,
  deleteRecordingArtifactPaths,
  type StreamRecordingSectionFinalizer,
  verifyStreamRecordingArtifactIdentity,
} from "./stream-recording-section-finalizer";
import type { StreamRecordingSessionStore } from "./stream-recording-session-store";

export interface StreamPlaybackResult {
  url: string;
  format: string;
  streamId?: string;
  qualities?: StreamRecordingQuality[];
}

export interface StreamRecorder {
  /** Settles only after the underlying writer has closed; rejection is terminal too. */
  stop(): Promise<{ outputPath: string; format: "mp4" | "ts"; partial: boolean }>;
  done: Promise<{ outputPath: string; format: "mp4" | "ts"; partial: boolean }>;
}

export interface StreamRecordingService {
  getSnapshot(): StreamRecordingSnapshot;
  startRecording(request: StreamRecordingRequest): Promise<StreamRecordingStartResult>;
  stopRecording(sessionId: string): Promise<{ success: boolean; error?: string }>;
  discardRecording(sessionId: string): Promise<{ success: boolean; error?: string }>;
  pauseRecording(sessionId: string): Promise<{ success: boolean; error?: string }>;
  resumeRecording(
    sessionId: string
  ): Promise<{ success: boolean; code?: "stream-changed" | "stream-unavailable"; error?: string }>;
  resumeInterrupted(sessionId: string): Promise<StreamRecordingRecoveryActionResult>;
  finalizeInterrupted(sessionId: string): Promise<StreamRecordingRecoveryActionResult>;
  dismissInterrupted(
    sessionId: string,
    confirmed: boolean
  ): Promise<StreamRecordingRecoveryActionResult>;
  openCompletedRecording(sessionId: string): Promise<{ success: boolean; error?: string }>;
  showCompletedRecording(sessionId: string): Promise<{ success: boolean; error?: string }>;
  dismissNotice(sessionId: string): Promise<{ success: boolean; error?: string }>;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultCreateId(): string {
  return `recording-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultCreateSectionPath(
  destinationPath: string,
  sectionNumber: number,
  sessionId: string
): string {
  return createOwnedRecordingSectionPath(destinationPath, sessionId, sectionNumber);
}

function replaceFileExtension(filePath: string, extension: string): string {
  const separatorIndex = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const extensionIndex = filePath.lastIndexOf(".");
  const stem = extensionIndex > separatorIndex ? filePath.slice(0, extensionIndex) : filePath;
  return `${stem}.${extension}`;
}

function normalizeMp4DestinationPath(requestedPath: string): string {
  return replaceFileExtension(requestedPath, "mp4");
}

function defaultIsSourceRemovedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /deleted|gone|not found|removed|source removed|no longer playable/i.test(message);
}

function isStreamChangedError(error: unknown): boolean {
  return (
    error instanceof Error && error.message === "This Channel is now showing a different Stream"
  );
}

function hasFinalizationCheckpoint(session: StreamRecordingSession): boolean {
  return (
    session.recoveryExhaustion?.state === "commit-intent" ||
    session.recoveryExhaustion?.state === "pending-probe" ||
    Boolean(session.committedOutputPath || session.committedArtifactIdentity)
  );
}

function appendGap(session: StreamRecordingSession, gap: StreamRecordingGap) {
  return [...session.gaps, gap];
}

function closeLastOpenGap(session: StreamRecordingSession, endedAt: string) {
  const index = session.gaps.findLastIndex((gap) => !gap.endedAt);
  if (index === -1) return session.gaps;
  return session.gaps.map((gap, gapIndex) => (gapIndex === index ? { ...gap, endedAt } : gap));
}

export function createStreamRecordingService({
  sessionStore,
  resolvePlayback,
  resolveQualityCatalog,
  chooseQuality,
  chooseSavePath,
  getAvailablePath,
  resolveFfmpegPath,
  startRecorder,
  sectionFinalizer = createStreamRecordingSectionFinalizer(),
  probeArtifact = createStreamRecordingArtifactProbe(),
  cleanupSections = cleanupRecordingSectionPaths,
  discardArtifacts = deleteRecordingArtifactPaths,
  cleanupFailedArtifact = cleanupRecordingSectionPaths,
  cleanupAbortedSection = async (sectionPath) => cleanupRecordingSectionPaths([sectionPath]),
  isRecordingSectionAvailable = defaultIsRecordingSectionAvailable,
  verifyArtifactIdentity = verifyStreamRecordingArtifactIdentity,
  // timer-allowlist: injectable transient completion-notice expiry owned by the recording service
  scheduleNoticeClear = (callback, delayMs) => setTimeout(callback, delayMs),
  completionNoticeTtlMs = 10_000,
  recordingFileActions = {
    exists: () => false,
    openPath: async () => "Recording file actions are unavailable",
    showItemInFolder: () => undefined,
  },
  createId = defaultCreateId,
  createSectionPath = defaultCreateSectionPath,
  now = defaultNow,
  sleep = defaultSleep,
  reconnectBackoffMs = [1000, 2000, 5000, 10000, 30000],
  reconnectWindowMs = 5 * 60 * 1000,
  monotonicNow = () => performance.now(),
  isSourceRemovedError = defaultIsSourceRemovedError,
  outcomeCoordinator,
}: {
  sessionStore: StreamRecordingSessionStore;
  resolvePlayback: (
    request: StreamRecordingRequest,
    signal?: AbortSignal,
    options?: { forceRefresh?: boolean }
  ) => Promise<StreamPlaybackResult>;
  resolveQualityCatalog?: (
    playback: StreamPlaybackResult,
    signal?: AbortSignal
  ) => Promise<StreamRecordingQuality[]>;
  chooseQuality: (qualities: StreamRecordingQuality[]) => Promise<StreamRecordingQuality | null>;
  chooseSavePath: (request: StreamRecordingRequest, extension: string) => Promise<string | null>;
  getAvailablePath: (path: string) => string;
  resolveFfmpegPath: () => string;
  startRecorder: (input: {
    ffmpegPath: string;
    inputUrl: string;
    destinationPath: string;
    onProgress: (progress: { elapsedSeconds: number }) => void;
  }) => StreamRecorder;
  sectionFinalizer?: StreamRecordingSectionFinalizer;
  probeArtifact?: StreamRecordingArtifactProbe;
  cleanupSections?: (paths: string[]) => Promise<void>;
  discardArtifacts?: (paths: string[]) => Promise<void>;
  cleanupFailedArtifact?: (paths: string[]) => Promise<void>;
  cleanupAbortedSection?: (path: string) => Promise<void>;
  isRecordingSectionAvailable?: (path: string) => Promise<boolean>;
  verifyArtifactIdentity?: (
    path: string,
    identity: StreamRecordingArtifactIdentity
  ) => Promise<boolean>;
  scheduleNoticeClear?: (callback: () => void, delayMs: number) => unknown;
  completionNoticeTtlMs?: number;
  recordingFileActions?: {
    exists(path: string): boolean;
    openPath(path: string): Promise<string>;
    showItemInFolder(path: string): void;
  };
  createId?: () => string;
  createSectionPath?: (destinationPath: string, sectionNumber: number, sessionId: string) => string;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  reconnectBackoffMs?: number[];
  reconnectWindowMs?: number;
  monotonicNow?: () => number;
  isSourceRemovedError?: (error: unknown) => boolean;
  outcomeCoordinator?: StreamRecordingOutcomeCoordinator;
}): StreamRecordingService {
  interface ActiveRecorderEntry {
    recorder: StreamRecorder;
    sectionId: string;
    capturedBaselineSeconds: number;
    intent: "capture" | "pause" | "stop";
  }

  const activeRecorders = new Map<string, ActiveRecorderEntry>();
  const transitions = new Set<string>();
  const persistenceFailureTransitions = new Map<string, Promise<void>>();
  const finishedSessions = new Set<string>();
  interface RecoveryContext {
    generation: number;
    controller: AbortController;
    deadlineTimer: ReturnType<typeof setTimeout>;
  }
  const recoveryContexts = new Map<string, RecoveryContext>();
  let recoveryGeneration = 0;
  type FinalizationResult = Awaited<ReturnType<StreamRecordingSectionFinalizer["finalize"]>>;
  const pendingFinalizations = new Map<string, FinalizationResult>();
  const recorderWaiters = new Map<string, (entry: ActiveRecorderEntry | null) => void>();
  let reservation: StreamRecordingRequest | null = null;
  const outcomes =
    outcomeCoordinator ??
    createStreamRecordingOutcomeCoordinator({
      sessionStore,
      getDeliveryContext: () => ({
        visible: true,
        focused: true,
        minimized: false,
        notificationsEnabled: false,
        soundEnabled: false,
        nativeSupported: false,
      }),
      showNative: () => undefined,
      focusWindow: () => undefined,
      recordingFileActions,
      verifyArtifactIdentity,
      scheduleClear: scheduleNoticeClear,
      noticeTtlMs: completionNoticeTtlMs,
    });

  function abortRecovery(sessionId: string): void {
    const context = recoveryContexts.get(sessionId);
    if (!context) return;
    clearTimeout(context.deadlineTimer);
    recoveryContexts.delete(sessionId);
    context.controller.abort();
  }

  function beginRecovery(sessionId: string): RecoveryContext {
    abortRecovery(sessionId);
    const controller = new AbortController();
    const context: RecoveryContext = {
      generation: ++recoveryGeneration,
      controller,
      // timer-allowlist: hard monotonic reconnect deadline aborts resolver and backoff work as one epoch
      deadlineTimer: setTimeout(() => controller.abort(), reconnectWindowMs),
    };
    recoveryContexts.set(sessionId, context);
    return context;
  }

  function isCurrentRecovery(sessionId: string, context: RecoveryContext): boolean {
    return (
      recoveryContexts.get(sessionId)?.generation === context.generation &&
      !context.controller.signal.aborted
    );
  }

  function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      void promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  async function qualityCatalog(
    playback: StreamPlaybackResult,
    signal?: AbortSignal
  ): Promise<StreamRecordingQuality[]> {
    if (resolveQualityCatalog) return resolveQualityCatalog(playback, signal);
    if (playback.qualities?.length) return playback.qualities;
    return [{ quality: "Source", url: playback.url, isSource: true }];
  }

  function qualityChanged(
    previous: StreamRecordingQuality | null | undefined,
    next: StreamRecordingQuality
  ): boolean {
    if (!previous) return false;
    return (
      previous.quality !== next.quality ||
      previous.height !== next.height ||
      previous.fps !== next.fps ||
      previous.bitrate !== next.bitrate
    );
  }

  function recoveredQualityPatch(
    session: StreamRecordingSession,
    quality: StreamRecordingQuality
  ): Pick<StreamRecordingSession, "qualityLabel" | "currentQuality" | "qualityChange"> {
    if (!qualityChanged(session.currentQuality, quality)) {
      return {
        qualityLabel: quality.quality,
        currentQuality: quality,
        qualityChange: session.qualityChange ?? null,
      };
    }
    return {
      qualityLabel: quality.quality,
      currentQuality: quality,
      qualityChange: {
        revision: (session.qualityChange?.revision ?? 0) + 1,
        fromQuality: session.currentQuality?.quality ?? session.qualityLabel ?? "Unknown",
        toQuality: quality.quality,
      },
    };
  }

  function getSession(sessionId?: string): StreamRecordingSession | null {
    const session = sessionStore.getJournal().session;
    return session && (!sessionId || session.id === sessionId) ? session : null;
  }

  function saveSession(session: StreamRecordingSession, patch: Partial<StreamRecordingSession>) {
    const next = { ...session, ...patch, updatedAt: now() };
    sessionStore.saveSession(next);
    return next;
  }

  function activeSummary(): ActiveStreamRecording | null {
    if (reservation) return { ...reservation, status: "preparing" };
    return sessionStore.getSnapshot().active;
  }

  function clearRuntime(sessionId: string) {
    recorderWaiters.get(sessionId)?.(null);
    recorderWaiters.delete(sessionId);
    activeRecorders.delete(sessionId);
    abortRecovery(sessionId);
    transitions.delete(sessionId);
    reservation = null;
  }

  function isTransitionLocked(sessionId: string): boolean {
    return transitions.has(sessionId) || persistenceFailureTransitions.has(sessionId);
  }

  async function finalizeRecording(
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (finishedSessions.has(sessionId)) return { success: true };
    const session = getSession(sessionId);
    if (!session) return { success: false, error: "Recording session not found" };
    if (session.recoveryExhaustion) {
      return finishExhaustedRecovery(session, session.recoveryExhaustion.error);
    }
    let result = pendingFinalizations.get(sessionId);
    try {
      if (
        !result &&
        session.committedOutputPath &&
        session.outputFormat &&
        session.committedArtifactIdentity &&
        recordingFileActions.exists(session.committedOutputPath)
      ) {
        result = {
          outputPath: session.committedOutputPath,
          format: session.outputFormat,
          usedFallback: session.usedFallback ?? session.outputFormat === "ts",
          ownedSectionPaths: session.sections.map((section) => section.path),
          artifactIdentity: session.committedArtifactIdentity,
        };
      }
      if (!result) {
        result = await sectionFinalizer.finalize({
          ffmpegPath: resolveFfmpegPath(),
          destinationPath: session.destinationPath,
          sections: session.sections,
          beforeCommit: async (intent) => {
            const intentSession = getSession(sessionId);
            if (!intentSession) {
              throw new Error("Recording session disappeared before output commit");
            }
            saveSession(intentSession, {
              status: "finalizing",
              recoveryExhaustion: {
                state: "commit-intent",
                error: "Recording interrupted during finalization",
                outputPath: intent.outputPath,
                outputFormat: intent.format,
                usedFallback: intent.usedFallback,
                artifactIdentity: intent.artifactIdentity,
              },
            });
          },
        });
      }
      pendingFinalizations.set(sessionId, result);
      const latest = getSession(sessionId);
      if (!latest) return { success: false, error: "Recording session not found" };
      if (
        latest.committedOutputPath !== result.outputPath ||
        latest.outputFormat !== result.format ||
        latest.committedArtifactIdentity?.digest !== result.artifactIdentity.digest
      ) {
        saveSession(latest, {
          status: "finalizing",
          committedOutputPath: result.outputPath,
          outputFormat: result.format,
          usedFallback: result.usedFallback,
          committedArtifactIdentity: result.artifactIdentity,
          statusMessage: "Recording output committed",
          recoveryExhaustion: null,
        });
      }
      const playable = await probeArtifact({
        ffmpegPath: resolveFfmpegPath(),
        outputPath: result.outputPath,
      });
      const ownershipVerified = await verifyArtifactIdentity(
        result.outputPath,
        result.artifactIdentity
      );
      if (!playable || !ownershipVerified) {
        if (ownershipVerified) {
          await cleanupFailedArtifact([result.outputPath]).catch(() => undefined);
        }
        const message = playable
          ? "Recording output ownership could not be verified"
          : "Recording output is not playable";
        if (
          !outcomes.settle(sessionId, {
            sessionId,
            outcome: "failed",
            platform: session.platform,
            channelName: session.channelName,
            title: session.title,
            error: message,
          })
        ) {
          throw new Error("Recording session changed before outcome delivery");
        }
        finishedSessions.add(sessionId);
        pendingFinalizations.delete(sessionId);
        clearRuntime(sessionId);
        await cleanupSections(result.ownedSectionPaths).catch(() => undefined);
        finishedSessions.delete(sessionId);
        return { success: false, error: message };
      }
      if (
        !outcomes.settle(sessionId, {
          sessionId,
          outcome: "completed",
          platform: session.platform,
          channelName: session.channelName,
          title: session.title,
          outputPath: result.outputPath,
          outputFormat: result.format,
          usedFallback: result.usedFallback,
          artifactIdentity: result.artifactIdentity,
        })
      ) {
        throw new Error("Recording session changed before outcome delivery");
      }
      finishedSessions.add(sessionId);
      pendingFinalizations.delete(sessionId);
      clearRuntime(sessionId);
      await cleanupSections(result.ownedSectionPaths).catch(() => undefined);
      finishedSessions.delete(sessionId);
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not finalize the stream recording";
      const latest = getSession(sessionId);
      if (latest && !result) {
        try {
          saveSession(latest, {
            status: "interrupted",
            statusMessage: message,
            partial: true,
          });
        } catch {
          const sectionId = latest.sections.at(-1)?.id;
          if (sectionId) {
            await interruptRecorderAfterPersistenceFailure(sessionId, sectionId, error);
          }
        }
      }
      if (!result) clearRuntime(sessionId);
      return { success: false, error: message };
    }
  }

  async function beginRecorder(
    sessionId: string,
    sectionId: string,
    inputUrl: string,
    destinationPath: string,
    capturedBaselineSeconds: number,
    onRecorderCreated?: () => void
  ): Promise<void> {
    let pendingElapsedSeconds: number | null = null;
    const publishProgress = (elapsedSeconds: number) => {
      const entry = activeRecorders.get(sessionId);
      if (!entry || entry.sectionId !== sectionId || entry.intent !== "capture") return;
      const session = getSession(sessionId);
      if (!session || (session.status !== "preparing" && session.status !== "recording")) return;
      saveSession(session, {
        capturedDurationSeconds: Math.max(
          session.capturedDurationSeconds,
          capturedBaselineSeconds + elapsedSeconds
        ),
      });
    };
    const recorder = startRecorder({
      ffmpegPath: resolveFfmpegPath(),
      inputUrl,
      destinationPath,
      onProgress: ({ elapsedSeconds }) => {
        if (!activeRecorders.has(sessionId)) pendingElapsedSeconds = elapsedSeconds;
        else {
          try {
            publishProgress(elapsedSeconds);
          } catch (error) {
            void interruptRecorderAfterPersistenceFailure(sessionId, sectionId, error);
          }
        }
      },
    });
    try {
      onRecorderCreated?.();
    } catch (error) {
      await Promise.allSettled([recorder.stop(), recorder.done]);
      throw error;
    }
    const entry: ActiveRecorderEntry = {
      recorder,
      sectionId,
      capturedBaselineSeconds,
      intent: "capture",
    };
    activeRecorders.set(sessionId, entry);
    recorderWaiters.get(sessionId)?.(entry);
    recorderWaiters.delete(sessionId);
    if (pendingElapsedSeconds !== null) {
      try {
        publishProgress(pendingElapsedSeconds);
      } catch (error) {
        await interruptRecorderAfterPersistenceFailure(sessionId, sectionId, error);
        throw error;
      }
    }
    void recorder.done.then(
      () => {
        if (activeRecorders.get(sessionId) === entry && entry.intent === "capture") {
          const session = getSession(sessionId);
          if (!session) return;
          const endedAt = now();
          try {
            saveSession(session, {
              status: "finalizing",
              sections: closeSection(session, sectionId, endedAt),
            });
            void finalizeRecording(sessionId);
          } catch (error) {
            void interruptRecorderAfterPersistenceFailure(sessionId, sectionId, error);
          }
        }
      },
      (error) => {
        if (
          finishedSessions.has(sessionId) ||
          activeRecorders.get(sessionId) !== entry ||
          entry.intent !== "capture"
        ) {
          return;
        }
        activeRecorders.delete(sessionId);
        void reconnectRecording(sessionId, sectionId, error).catch((reconnectError) => {
          void interruptRecorderAfterPersistenceFailure(sessionId, sectionId, reconnectError);
        });
      }
    );
  }

  function interruptRecorderAfterPersistenceFailure(
    sessionId: string,
    sectionId: string,
    error: unknown
  ): Promise<void> {
    const existing = persistenceFailureTransitions.get(sessionId);
    if (existing) return existing;
    const interruption = Promise.resolve()
      .then(() => performPersistenceFailureInterruption(sessionId, sectionId, error))
      .finally(() => {
        if (persistenceFailureTransitions.get(sessionId) === interruption) {
          persistenceFailureTransitions.delete(sessionId);
        }
      });
    persistenceFailureTransitions.set(sessionId, interruption);
    return interruption;
  }

  async function performPersistenceFailureInterruption(
    sessionId: string,
    sectionId: string,
    error: unknown
  ): Promise<void> {
    const activeEntry = activeRecorders.get(sessionId);
    if (activeEntry && (activeEntry.sectionId !== sectionId || activeEntry.intent !== "capture")) {
      return;
    }
    if (activeEntry) activeEntry.intent = "pause";
    const message = error instanceof Error ? error.message : "Recording state could not be saved";
    const session = getSession(sessionId);
    if (session) {
      try {
        saveSession(session, {
          status: "interrupted",
          partial: true,
          statusMessage: message,
          sections: closeSection(session, sectionId, now()),
        });
      } catch {
        // The recorder still has to stop when persistence remains unavailable.
      }
    }
    if (activeEntry) {
      try {
        await activeEntry.recorder.stop();
      } catch {
        // The persisted Interrupted state still records that capture did not finish cleanly.
      }
      if (activeRecorders.get(sessionId) === activeEntry) activeRecorders.delete(sessionId);
    }
    abortRecovery(sessionId);
  }

  async function rollbackSpawnedRecorder(
    sessionId: string,
    section: StreamRecordingSection,
    previousSession: StreamRecordingSession,
    error: unknown,
    writerWasSpawned = false
  ): Promise<"retry" | "stop"> {
    const failedEntry = activeRecorders.get(sessionId);
    const ownsSpawnedWriter = writerWasSpawned || failedEntry?.sectionId === section.id;
    if (failedEntry?.sectionId === section.id) {
      failedEntry.intent = "pause";
      try {
        await failedEntry.recorder.stop();
      } catch {
        if (activeRecorders.get(sessionId) === failedEntry) activeRecorders.delete(sessionId);
        const interrupted = getSession(sessionId);
        if (interrupted) {
          try {
            saveSession(interrupted, {
              status: "interrupted",
              partial: true,
              statusMessage: error instanceof Error ? error.message : "Recording recovery failed",
              sections: closeSection(interrupted, section.id, now()),
            });
          } catch {
            // Keep the last durable recovery journal when persistence remains unavailable.
          }
        }
        abortRecovery(sessionId);
        return "stop";
      }
      if (activeRecorders.get(sessionId) === failedEntry) activeRecorders.delete(sessionId);
    }

    if (
      ownsSpawnedWriter &&
      isOwnedRecordingSection(
        previousSession.destinationPath,
        previousSession.id,
        previousSession.sections.length + 1,
        section
      )
    ) {
      await cleanupAbortedSection(section.path).catch(() => undefined);
    }
    const attempted = getSession(sessionId);
    if (!attempted?.sections.some(({ id }) => id === section.id)) return "retry";
    try {
      sessionStore.saveSession(previousSession);
      return "retry";
    } catch (restoreError) {
      try {
        saveSession(attempted, {
          status: "interrupted",
          partial: true,
          statusMessage:
            restoreError instanceof Error
              ? restoreError.message
              : "Recording recovery could not be restored",
          sections: closeSection(attempted, section.id, now()),
        });
      } catch {
        // The Preparing journal still preserves every section for restart recovery.
      }
      abortRecovery(sessionId);
      return "stop";
    }
  }

  function closeSection(
    session: StreamRecordingSession,
    sectionId: string,
    endedAt: string
  ): StreamRecordingSession["sections"] {
    return session.sections.map((section) =>
      section.id === sectionId && !section.endedAt ? { ...section, endedAt } : section
    );
  }

  function closeOpenSections(
    session: StreamRecordingSession,
    endedAt: string
  ): StreamRecordingSession["sections"] {
    return session.sections.map((section) => (section.endedAt ? section : { ...section, endedAt }));
  }

  function nextSection(session: StreamRecordingSession, startedAt: string) {
    const sectionNumber = session.sections.length + 1;
    return {
      id: `${session.id}-part-${sectionNumber}`,
      path: createSectionPath(session.destinationPath, sectionNumber, session.id),
      startedAt,
    };
  }

  async function finishExhaustedRecovery(
    session: StreamRecordingSession,
    recoveryError: string,
    preserveEvidenceOnFailure = false
  ): Promise<{ success: boolean; error?: string }> {
    transitions.add(session.id);
    let ownedArtifact: { path: string; identity: StreamRecordingArtifactIdentity } | null = null;
    try {
      let latest = getSession(session.id) ?? session;
      const committedCheckpoint: StreamRecordingRecoveryExhaustion | null =
        latest.committedOutputPath &&
        latest.committedArtifactIdentity &&
        (latest.outputFormat === "mp4" || latest.outputFormat === "ts") &&
        typeof latest.usedFallback === "boolean"
          ? {
              state: "pending-probe",
              error: recoveryError,
              outputPath: latest.committedOutputPath,
              outputFormat: latest.outputFormat,
              usedFallback: latest.usedFallback,
              artifactIdentity: latest.committedArtifactIdentity,
            }
          : null;
      let exhaustion: StreamRecordingRecoveryExhaustion = latest.recoveryExhaustion ??
        committedCheckpoint ?? {
          state: "finalizing",
          error: recoveryError,
        };
      latest = saveSession(latest, {
        status: "finalizing",
        partial: true,
        statusMessage: "Preserving partial recording",
        recoveryExhaustion: exhaustion,
      });

      let result: Awaited<ReturnType<StreamRecordingSectionFinalizer["finalize"]>>;
      if (
        (exhaustion.state === "pending-probe" || exhaustion.state === "commit-intent") &&
        recordingFileActions.exists(exhaustion.outputPath) &&
        (await verifyArtifactIdentity(exhaustion.outputPath, exhaustion.artifactIdentity))
      ) {
        result = {
          outputPath: exhaustion.outputPath,
          format: exhaustion.outputFormat,
          usedFallback: exhaustion.usedFallback,
          ownedSectionPaths: latest.sections.map((section) => section.path),
          artifactIdentity: exhaustion.artifactIdentity,
        };
        ownedArtifact = { path: exhaustion.outputPath, identity: exhaustion.artifactIdentity };
      } else if (exhaustion.state === "pending-probe") {
        throw new Error("Recovered recording output ownership could not be verified");
      } else {
        for (const [index, section] of latest.sections.entries()) {
          if (
            !isOwnedRecordingSection(latest.destinationPath, latest.id, index + 1, section) ||
            !(await isRecordingSectionAvailable(section.path))
          ) {
            throw new Error(
              "A preserved recording section is no longer available or safely readable"
            );
          }
        }
        exhaustion = { state: "finalizing", error: exhaustion.error };
        latest = saveSession(latest, { recoveryExhaustion: exhaustion });
        result = await sectionFinalizer.finalize({
          ffmpegPath: resolveFfmpegPath(),
          destinationPath: latest.destinationPath,
          sections: latest.sections,
          beforeCommit: async (intent) => {
            const intentSession = getSession(latest.id);
            if (!intentSession) {
              throw new Error("Recording session disappeared before output commit");
            }
            saveSession(intentSession, {
              recoveryExhaustion: {
                state: "commit-intent",
                error: exhaustion.error,
                outputPath: intent.outputPath,
                outputFormat: intent.format,
                usedFallback: intent.usedFallback,
                artifactIdentity: intent.artifactIdentity,
              },
            });
          },
        });
        if (
          !result.artifactIdentity ||
          !(await verifyArtifactIdentity(result.outputPath, result.artifactIdentity))
        ) {
          throw new Error("Committed recording output ownership could not be verified");
        }
        ownedArtifact = { path: result.outputPath, identity: result.artifactIdentity };
      }
      if (!result.artifactIdentity) {
        throw new Error("Recording finalizer did not return artifact ownership");
      }
      const committedSession = getSession(latest.id);
      if (!committedSession) throw new Error("Recording session disappeared before output probe");
      saveSession(committedSession, {
        committedOutputPath: result.outputPath,
        committedArtifactIdentity: result.artifactIdentity,
        outputFormat: result.format,
        usedFallback: result.usedFallback,
        partial: true,
        statusMessage: "Checking partial recording",
        recoveryExhaustion: {
          state: "pending-probe",
          error: exhaustion.error,
          outputPath: result.outputPath,
          outputFormat: result.format,
          usedFallback: result.usedFallback,
          artifactIdentity: result.artifactIdentity,
        },
      });
      const playable = await probeArtifact({
        ffmpegPath: resolveFfmpegPath(),
        outputPath: result.outputPath,
      });
      if (!playable) throw new Error("Recovered recording output is not playable");
      if (!(await verifyArtifactIdentity(result.outputPath, result.artifactIdentity))) {
        throw new Error("Recovered recording output ownership changed during probe");
      }
      try {
        if (
          !outcomes.settle(latest.id, {
            sessionId: latest.id,
            outcome: "partial",
            platform: latest.platform,
            channelName: latest.channelName,
            title: latest.title,
            outputPath: result.outputPath,
            outputFormat: result.format,
            usedFallback: result.usedFallback,
            artifactIdentity: result.artifactIdentity,
            error: exhaustion.error,
          })
        ) {
          clearRuntime(latest.id);
          return {
            success: false,
            error: "Recording session changed before partial outcome delivery",
          };
        }
      } catch (settlementError) {
        clearRuntime(latest.id);
        return {
          success: false,
          error:
            settlementError instanceof Error
              ? settlementError.message
              : "Could not clear the recording recovery journal",
        };
      }
      clearRuntime(latest.id);
      await cleanupSections(result.ownedSectionPaths).catch(() => undefined);
      return { success: true };
    } catch (error) {
      if (
        ownedArtifact &&
        (await verifyArtifactIdentity(ownedArtifact.path, ownedArtifact.identity))
      ) {
        await cleanupFailedArtifact([ownedArtifact.path]).catch(() => undefined);
      }
      const preservationError = error instanceof Error ? error.message : "No playable output";
      if (preserveEvidenceOnFailure) {
        const latest = getSession(session.id);
        if (latest) {
          try {
            saveSession(latest, {
              status: "interrupted",
              partial: true,
              statusMessage: preservationError,
              recoveryExhaustion: { state: "finalizing", error: recoveryError },
              ...(ownedArtifact
                ? {
                    committedOutputPath: null,
                    committedArtifactIdentity: null,
                    outputFormat: null,
                    usedFallback: undefined,
                  }
                : {}),
            });
          } catch {
            // Keep the last durable recovery journal when persistence remains unavailable.
          }
        }
        clearRuntime(session.id);
        return { success: false, error: preservationError };
      }
      outcomes.settle(session.id, {
        sessionId: session.id,
        outcome: "failed",
        platform: session.platform,
        channelName: session.channelName,
        title: session.title,
        error: `${recoveryError}. ${preservationError}`,
      });
      clearRuntime(session.id);
      return { success: false, error: preservationError };
    } finally {
      transitions.delete(session.id);
    }
  }

  async function reconnectRecording(
    sessionId: string,
    sectionId: string,
    error: unknown
  ): Promise<void> {
    const session = getSession(sessionId);
    if (!session) return;
    if (isSourceRemovedError(error)) {
      const endedAt = now();
      const closed = saveSession(session, {
        status: "reconnecting",
        partial: true,
        statusMessage: "Preserving partial recording",
        sections: closeSection(session, sectionId, endedAt),
        gaps: appendGap(session, { startedAt: endedAt, endedAt, reason: "reconnect" }),
      });
      await finishExhaustedRecovery(
        closed,
        error instanceof Error ? error.message : "Stream unavailable"
      );
      return;
    }

    const recovery = beginRecovery(sessionId);
    const deadline = monotonicNow() + reconnectWindowMs;
    let current = saveSession(session, {
      status: "reconnecting",
      partial: true,
      statusMessage: "Reconnecting",
      sections: closeSection(session, sectionId, now()),
      gaps: appendGap(session, { startedAt: now(), reason: "reconnect" }),
    });
    let lastError = error;
    let retryIndex = 0;
    while (isCurrentRecovery(sessionId, recovery) && monotonicNow() < deadline) {
      const configuredBackoff =
        reconnectBackoffMs[Math.min(retryIndex, reconnectBackoffMs.length - 1)] ??
        reconnectWindowMs;
      const backoffMs = Math.min(configuredBackoff, Math.max(0, deadline - monotonicNow()));
      try {
        await abortable(sleep(backoffMs), recovery.controller.signal);
      } catch {
        break;
      }
      if (!isCurrentRecovery(sessionId, recovery) || monotonicNow() >= deadline) break;
      try {
        const playback = await abortable(
          resolvePlayback(current, recovery.controller.signal, { forceRefresh: true }),
          recovery.controller.signal
        );
        if (!isCurrentRecovery(sessionId, recovery)) return;
        if (!playback.streamId) throw new Error("The current Stream identity is unavailable");
        if (playback.streamId !== current.streamId) {
          throw new Error("This Channel is now showing a different Stream");
        }
        if (playback.format !== "hls") throw new Error("Only HLS stream recording is supported");
        const variants = await abortable(
          qualityCatalog(playback, recovery.controller.signal),
          recovery.controller.signal
        );
        if (!isCurrentRecovery(sessionId, recovery)) return;
        const latest = getSession(sessionId);
        if (!latest || latest.status !== "reconnecting") return;
        const recoveredQuality =
          selectStreamRecordingQuality(
            variants,
            latest.desiredQuality ?? latest.currentQuality ?? null
          ) ??
          ({
            quality: "Source",
            url: playback.url,
            isSource: true,
          } satisfies StreamRecordingQuality);
        const startedAt = now();
        const section = nextSection(latest, startedAt);
        let preparing: StreamRecordingSession | null = null;
        let writerWasSpawned = false;
        try {
          await beginRecorder(
            sessionId,
            section.id,
            recoveredQuality.url ?? playback.url,
            section.path,
            latest.capturedDurationSeconds,
            () => {
              writerWasSpawned = true;
              preparing = saveSession(latest, {
                status: "preparing",
                statusMessage: "Reconnecting",
                sections: [...latest.sections, section],
                gaps: closeLastOpenGap(latest, startedAt),
                ...recoveredQualityPatch(latest, recoveredQuality),
              });
            }
          );
        } catch (error) {
          await rollbackSpawnedRecorder(sessionId, section, latest, error, writerWasSpawned);
          current = latest;
          throw error;
        }
        if (!preparing) throw new Error("Recording session was not published after recorder start");
        const started = getSession(sessionId);
        if (started?.status === "preparing") {
          try {
            current = saveSession(started, { status: "recording", statusMessage: null });
          } catch (error) {
            const recoveryAction = await rollbackSpawnedRecorder(sessionId, section, latest, error);
            if (recoveryAction === "stop") return;
            current = latest;
            throw error;
          }
        } else if (started?.status !== "finalizing") {
          throw new Error("Recording session changed during reconnect");
        }
        clearTimeout(recovery.deadlineTimer);
        recoveryContexts.delete(sessionId);
        return;
      } catch (reconnectError) {
        if (!isCurrentRecovery(sessionId, recovery)) break;
        lastError = reconnectError;
        if (isSourceRemovedError(reconnectError) || isStreamChangedError(reconnectError)) break;
      }
      retryIndex += 1;
    }
    if (recoveryContexts.get(sessionId) !== recovery) return;
    clearTimeout(recovery.deadlineTimer);
    recoveryContexts.delete(sessionId);
    await finishExhaustedRecovery(
      current,
      lastError instanceof Error ? lastError.message : "Stream recording reconnect exhausted"
    );
  }

  return {
    getSnapshot: () => sessionStore.getSnapshot(),
    async startRecording(request) {
      const existing = activeSummary();
      if (existing) {
        return {
          success: false,
          outcome: "blocked",
          code: "stream-recording-active",
          error: "A Stream Recording is already active",
          activeRecording: existing,
        };
      }
      reservation = request;
        let session: StreamRecordingSession | null = null;
        try {
          const playback = await resolvePlayback(request);
          const stableStreamId = playback.streamId?.trim() || request.streamId?.trim();
          if (!stableStreamId) throw new Error("Stable Stream identity is unavailable");
        if (playback.format !== "hls") throw new Error("Only HLS stream recording is supported");
        const variants = await qualityCatalog(playback);
        const selectedQuality =
          request.desiredQuality !== undefined
            ? selectStreamRecordingQuality(variants, request.desiredQuality)
            : variants.length > 1
              ? await chooseQuality(variants)
              : (variants[0] ?? null);
        if (variants.length > 1 && !selectedQuality) {
          reservation = null;
          return { success: false, outcome: "cancelled", error: "Quality selection cancelled" };
        }
        const chosenPath = await chooseSavePath(request, ".mp4");
        if (!chosenPath) {
          reservation = null;
          return { success: false, outcome: "cancelled", error: "Save cancelled" };
        }
        const timestamp = now();
        const id = createId();
        const destinationPath = getAvailablePath(normalizeMp4DestinationPath(chosenPath));
        const firstSectionPath = createSectionPath(destinationPath, 1, id);
        session = {
            id,
            ...request,
            streamId: stableStreamId,
          status: "preparing",
          destinationPath,
          qualityLabel: selectedQuality?.quality ?? null,
          desiredQuality: selectedQuality,
          currentQuality: selectedQuality,
          qualityChange: null,
          capturedDurationSeconds: 0,
          sections: [{ id: `${id}-part-1`, path: firstSectionPath, startedAt: timestamp }],
          gaps: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        sessionStore.setNotice(null);
        sessionStore.saveSession(session);
        reservation = null;
        await beginRecorder(
          session.id,
          session.sections[0].id,
          selectedQuality?.url ?? playback.url,
          session.sections[0].path,
          0
        );
        const latestSession = getSession(session.id);
        if (!latestSession) throw new Error("Recording session disappeared during start");
        if (latestSession.status === "preparing") {
          saveSession(latestSession, { status: "recording" });
        } else if (latestSession.status !== "finalizing") {
          throw new Error("Recording session changed during start");
        }
        return { success: true, outcome: "started", sessionId: session.id };
      } catch (error) {
        if (session) {
          const entry = activeRecorders.get(session.id);
          if (entry) {
            await interruptRecorderAfterPersistenceFailure(session.id, entry.sectionId, error);
          }
          recorderWaiters.get(session.id)?.(null);
          recorderWaiters.delete(session.id);
          activeRecorders.delete(session.id);
          if (getSession(session.id)?.status !== "interrupted") {
            try {
              sessionStore.clearSession();
            } catch {
              // The failed start still releases all in-memory ownership when storage is unavailable.
            }
          }
        }
        reservation = null;
        return {
          success: false,
          outcome: "failed",
          error: error instanceof Error ? error.message : "Stream recording failed",
        };
      }
    },
    async stopRecording(sessionId) {
      if (isTransitionLocked(sessionId)) return { success: false, error: "Recording is busy" };
      let entry = activeRecorders.get(sessionId);
      const session = getSession(sessionId);
      if (!session) return { success: false, error: "Recording session not found" };
      if (session.recoveryExhaustion) {
        return finishExhaustedRecovery(session, session.recoveryExhaustion.error);
      }
      if (session.status === "finalizing") {
        if (pendingFinalizations.has(sessionId) || session.committedOutputPath) {
          return finalizeRecording(sessionId);
        }
        return { success: false, error: "Recording is busy" };
      }
      if (session.status === "interrupted" && session.committedOutputPath) {
        return finalizeRecording(sessionId);
      }
      if (
        session.status !== "preparing" &&
        session.status !== "recording" &&
        session.status !== "paused" &&
        session.status !== "reconnecting"
      ) {
        return { success: false, error: "Recording cannot be stopped in its current state" };
      }
      transitions.add(sessionId);
      let recorderReady: Promise<ActiveRecorderEntry | null> | null = null;
      let recorderStopped = false;
      try {
        abortRecovery(sessionId);
        recorderReady =
          !entry && session.status === "preparing"
            ? new Promise<ActiveRecorderEntry | null>((resolve) => {
                recorderWaiters.set(sessionId, resolve);
              })
            : null;
        saveSession(session, { status: "finalizing", statusMessage: "Finalizing recording" });
        if (recorderReady) entry = (await recorderReady) ?? undefined;
        if (entry) {
          entry.intent = "stop";
          await entry.recorder.stop();
          recorderStopped = true;
          if (activeRecorders.get(sessionId) === entry) activeRecorders.delete(sessionId);
          const latest = getSession(sessionId);
          if (!latest) return { success: false, error: "Recording session not found" };
          saveSession(latest, { sections: closeSection(latest, entry.sectionId, now()) });
        }
        return await finalizeRecording(sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream recording failed";
        if (!entry && recorderReady) entry = (await recorderReady) ?? undefined;
        if (entry && !recorderStopped) {
          entry.intent = "stop";
          try {
            await entry.recorder.stop();
            recorderStopped = true;
          } catch {
            // A terminal failure leaves the section unverified.
          }
        }
        if (entry && activeRecorders.get(sessionId) === entry) activeRecorders.delete(sessionId);
        const latest = getSession(sessionId);
        if (latest) {
          try {
            saveSession(latest, {
              status: "interrupted",
              statusMessage: message,
              partial: true,
              ...(entry && recorderStopped
                ? { sections: closeSection(latest, entry.sectionId, now()) }
                : {}),
            });
          } catch {
            // Preserve the last durable journal when recovery persistence is unavailable.
          }
        }
        clearRuntime(sessionId);
        return { success: false, error: message };
      } finally {
        transitions.delete(sessionId);
      }
    },
    async discardRecording(sessionId) {
      if (isTransitionLocked(sessionId)) return { success: false, error: "Recording is busy" };
      let entry = activeRecorders.get(sessionId);
      const session = getSession(sessionId);
      if (!session) return { success: false, error: "Recording session not found" };
      if (
        session.status !== "preparing" &&
        session.status !== "recording" &&
        session.status !== "paused" &&
        session.status !== "reconnecting"
      ) {
        return { success: false, error: "Recording cannot be discarded in its current state" };
      }
      const ownedPaths = session.sections.flatMap((section, index) =>
        isOwnedRecordingSection(
          session.destinationPath,
          session.id,
          index + 1,
          section
        )
          ? [section.path]
          : []
      );
      if (ownedPaths.length !== session.sections.length) {
        return { success: false, error: "Recording artifact ownership could not be verified" };
      }
      const ownedPathSet = new Set(ownedPaths);
      const outputCandidates = [
        session.committedOutputPath &&
        session.committedArtifactIdentity &&
        session.outputFormat &&
        typeof session.usedFallback === "boolean"
          ? {
              path: session.committedOutputPath,
              identity: session.committedArtifactIdentity,
              format: session.outputFormat,
              usedFallback: session.usedFallback,
            }
          : null,
        session.recoveryExhaustion?.state === "commit-intent" ||
        session.recoveryExhaustion?.state === "pending-probe"
          ? {
              path: session.recoveryExhaustion.outputPath,
              identity: session.recoveryExhaustion.artifactIdentity,
              format: session.recoveryExhaustion.outputFormat,
              usedFallback: session.recoveryExhaustion.usedFallback,
            }
          : null,
      ].filter((candidate) => candidate !== null);
      for (const output of outputCandidates) {
        if (
          !isOwnedRecordingOutput(
            session.destinationPath,
            output.path,
            output.format,
            output.usedFallback
          ) ||
          !(await verifyArtifactIdentity(output.path, output.identity))
        ) {
          return { success: false, error: "Recording artifact ownership could not be verified" };
        }
        if (!ownedPathSet.has(output.path)) {
          ownedPathSet.add(output.path);
          ownedPaths.push(output.path);
        }
      }

      transitions.add(sessionId);
      let recorderReady: Promise<ActiveRecorderEntry | null> | null = null;
      try {
        abortRecovery(sessionId);
        recorderReady =
          !entry && session.status === "preparing"
            ? new Promise<ActiveRecorderEntry | null>((resolve) => {
                recorderWaiters.set(sessionId, resolve);
              })
            : null;
        if (recorderReady) entry = (await recorderReady) ?? undefined;
        if (entry) {
          entry.intent = "stop";
          try {
            await entry.recorder.stop();
          } catch (error) {
            entry.intent = "capture";
            throw error;
          }
          if (activeRecorders.get(sessionId) === entry) activeRecorders.delete(sessionId);
        }
        await discardArtifacts(ownedPaths);
        sessionStore.clearSession();
        clearRuntime(sessionId);
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not discard recording";
        const latest = getSession(sessionId);
        if (latest && (!entry || activeRecorders.get(sessionId) !== entry)) {
          try {
            saveSession(latest, {
              status: "interrupted",
              partial: true,
              statusMessage: message,
              ...(entry ? { sections: closeSection(latest, entry.sectionId, now()) } : {}),
            });
          } catch {
            // Preserve the last durable journal when discard cleanup cannot complete.
          }
        }
        return { success: false, error: message };
      } finally {
        recorderWaiters.delete(sessionId);
        transitions.delete(sessionId);
      }
    },
    async pauseRecording(sessionId) {
      if (isTransitionLocked(sessionId)) return { success: false, error: "Recording is busy" };
      const entry = activeRecorders.get(sessionId);
      const session = getSession(sessionId);
      if (!session) return { success: false, error: "Recording session not found" };
      if (session.status === "reconnecting") {
        try {
          saveSession(session, { status: "paused", statusMessage: null });
          abortRecovery(sessionId);
          return { success: true };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Pause failed",
          };
        }
      }
      if (!entry) return { success: false, error: "Recording session not found" };
      if (session.status !== "recording") {
        return { success: false, error: "Only an active recording can be paused" };
      }
      transitions.add(sessionId);
      try {
        entry.intent = "pause";
        try {
          saveSession(session, { status: "paused", statusMessage: "Pausing" });
        } catch (error) {
          entry.intent = "capture";
          return {
            success: false,
            error: error instanceof Error ? error.message : "Pause failed",
          };
        }
        await entry.recorder.stop();
        if (activeRecorders.get(sessionId) !== entry) {
          throw new Error("Recording section changed during pause");
        }
        activeRecorders.delete(sessionId);
        const latest = getSession(sessionId);
        if (!latest) throw new Error("Recording session not found");
        const pausedAt = now();
        saveSession(latest, {
          status: "paused",
          statusMessage: null,
          sections: closeSection(latest, entry.sectionId, pausedAt),
          gaps: appendGap(latest, { startedAt: pausedAt, reason: "paused" }),
        });
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Pause failed";
        const latest = getSession(sessionId);
        if (latest) {
          try {
            saveSession(latest, {
              status: "interrupted",
              statusMessage: message,
              partial: true,
            });
          } catch {
            // Preserve the last durable journal when recovery persistence is unavailable.
          }
        }
        clearRuntime(sessionId);
        return { success: false, error: message };
      } finally {
        transitions.delete(sessionId);
      }
    },
    async resumeRecording(sessionId) {
      if (isTransitionLocked(sessionId)) return { success: false, error: "Recording is busy" };
      const session = getSession(sessionId);
      if (!session) return { success: false, error: "Recording session not found" };
      if (session.status !== "paused") {
        return { success: false, error: "Only a paused recording can be resumed" };
      }
      transitions.add(sessionId);
      try {
        const playback = await resolvePlayback(session, undefined, { forceRefresh: true });
        const resumedStreamId = playback.streamId?.trim() || session.streamId?.trim();
        if (!resumedStreamId) {
          return {
            success: false,
            code: "stream-unavailable",
            error: "The current Stream identity is unavailable",
          };
        }
        if (resumedStreamId !== session.streamId) {
          return {
            success: false,
            code: "stream-changed",
            error: "This Channel is now showing a different Stream",
          };
        }
        if (playback.format !== "hls") throw new Error("Only HLS stream recording is supported");
        const variants = await qualityCatalog(playback);
        const latest = getSession(sessionId);
        if (!latest || latest.status !== "paused") {
          return { success: false, error: "Recording session changed during resume" };
        }
        const resumedQuality =
          selectStreamRecordingQuality(
            variants,
            latest.desiredQuality ?? latest.currentQuality ?? null
          ) ??
          ({
            quality: "Source",
            url: playback.url,
            isSource: true,
          } satisfies StreamRecordingQuality);
        const resumedAt = now();
        const section = nextSection(latest, resumedAt);
        const preparing = saveSession(latest, {
          status: "preparing",
          statusMessage: "Resuming",
          sections: [...latest.sections, section],
          gaps: closeLastOpenGap(latest, resumedAt),
          ...recoveredQualityPatch(latest, resumedQuality),
        });
        try {
          await beginRecorder(
            sessionId,
            section.id,
            resumedQuality.url ?? playback.url,
            section.path,
            preparing.capturedDurationSeconds
          );
          const started = getSession(sessionId);
          if (!started || started.status !== "preparing") {
            throw new Error("Recording session changed while the recorder was starting");
          }
          saveSession(started, { status: "recording", statusMessage: null });
        } catch (error) {
          await rollbackSpawnedRecorder(sessionId, section, latest, error);
          throw error;
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : "Resume failed" };
      } finally {
        transitions.delete(sessionId);
      }
    },
    async resumeInterrupted(sessionId) {
      if (isTransitionLocked(sessionId)) {
        return { success: false, code: "busy", error: "Recording is busy" };
      }
      const session = getSession(sessionId);
      if (!session || session.status !== "interrupted") {
        return {
          success: false,
          code: "not-found",
          error: "Interrupted recording session not found",
        };
      }
      if (hasFinalizationCheckpoint(session)) {
        return {
          success: false,
          code: "finalize-required",
          error:
            "This recording has already started finalizing. Finalize the partial recording instead.",
        };
      }
      if (!session.streamId) {
        return {
          success: false,
          code: "finalize-required",
          error:
            "This legacy recording cannot verify the same Stream. Finalize the partial recording instead.",
        };
      }
      transitions.add(sessionId);
      let recoverySection: StreamRecordingSection | null = null;
      let recoveryWriterWasSpawned = false;
      let checkingStream = false;
      try {
        for (const [index, section] of session.sections.entries()) {
          const owned = isOwnedRecordingSection(
            session.destinationPath,
            session.id,
            index + 1,
            section
          );
          if (!owned || !(await isRecordingSectionAvailable(section.path))) {
            return {
              success: false,
              code: "resume-failed",
              error: "A preserved recording section is no longer available or safely readable",
            };
          }
        }
        checkingStream = true;
        const playback = await resolvePlayback(session, undefined, { forceRefresh: true });
        if (!playback.streamId) {
          throw new Error("The current Stream identity is unavailable");
        }
        if (playback.streamId !== session.streamId) {
          return {
            success: false,
            code: "stream-changed",
            error: "This Channel is now showing a different Stream",
          };
        }
        if (playback.format !== "hls") {
          throw new Error("Only HLS stream recording is supported");
        }
        const variants = await qualityCatalog(playback);
        if (variants.length === 0) throw new Error("The stream has no playable recording quality");
        const latest = getSession(sessionId);
        if (!latest || latest.status !== "interrupted") {
          return {
            success: false,
            code: "resume-failed",
            error: "Recording session changed during recovery",
          };
        }
        const resumedQuality = selectStreamRecordingQuality(
          variants,
          latest.desiredQuality ?? latest.currentQuality ?? null
        );
        if (!resumedQuality) throw new Error("The stream has no playable recording quality");
        const resumedAt = now();
        const section = nextSection(latest, resumedAt);
        recoverySection = section;
        checkingStream = false;
        let preparing: StreamRecordingSession | null = null;
        await beginRecorder(
          sessionId,
          section.id,
          resumedQuality.url ?? playback.url,
          section.path,
          latest.capturedDurationSeconds,
          () => {
            recoveryWriterWasSpawned = true;
            preparing = saveSession(latest, {
              status: "preparing",
              statusMessage: "Resuming interrupted recording",
              sections: [...closeOpenSections(latest, resumedAt), section],
              gaps: closeLastOpenGap(latest, resumedAt),
              recoveryExhaustion: null,
              ...recoveredQualityPatch(latest, resumedQuality),
            });
          }
        );
        if (!preparing) throw new Error("Recording recovery was not published");
        const started = getSession(sessionId);
        if (!started || started.status !== "preparing") {
          throw new Error("Recording session changed while recovery was starting");
        }
        saveSession(started, { status: "recording", statusMessage: null });
        return { success: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not resume interrupted recording";
        if (recoverySection) {
          const entry = activeRecorders.get(sessionId);
          if (entry?.sectionId === recoverySection.id) {
            entry.intent = "pause";
            await entry.recorder.stop().catch(() => undefined);
            if (activeRecorders.get(sessionId) === entry) activeRecorders.delete(sessionId);
          }
          if (
            recoveryWriterWasSpawned &&
            isOwnedRecordingSection(
              session.destinationPath,
              session.id,
              session.sections.length + 1,
              recoverySection
            )
          ) {
            await cleanupAbortedSection(recoverySection.path).catch(() => undefined);
          }
          const current = getSession(sessionId);
          if (current?.sections.some((section) => section.id === recoverySection?.id)) {
            try {
              sessionStore.saveSession(session);
            } catch (restoreError) {
              return {
                success: false,
                code: "resume-failed",
                error:
                  restoreError instanceof Error
                    ? `${message}. ${restoreError.message}`
                    : `${message}. Recovery state could not be restored`,
              };
            }
          }
        }
        return {
          success: false,
          code: checkingStream ? "stream-unavailable" : "resume-failed",
          error: message,
        };
      } finally {
        transitions.delete(sessionId);
      }
    },
    async finalizeInterrupted(sessionId) {
      if (isTransitionLocked(sessionId)) {
        return { success: false, code: "busy", error: "Recording is busy" };
      }
      const session = getSession(sessionId);
      if (!session || session.status !== "interrupted") {
        return {
          success: false,
          code: "not-found",
          error: "Interrupted recording session not found",
        };
      }
      const result = await finishExhaustedRecovery(
        session,
        "Recording interrupted when StreamFusion closed",
        true
      );
      return result.success
        ? { success: true }
        : {
            success: false,
            code: "finalize-failed",
            error: result.error ?? "Could not finalize partial recording",
          };
    },
    async dismissInterrupted(sessionId, confirmed) {
      if (!confirmed) {
        return {
          success: false,
          code: "confirmation-required",
          error: "Confirmation is required",
        };
      }
      if (isTransitionLocked(sessionId)) {
        return { success: false, code: "busy", error: "Recording is busy" };
      }
      const session = getSession(sessionId);
      if (!session || session.status !== "interrupted") {
        return {
          success: false,
          code: "not-found",
          error: "Interrupted recording session not found",
        };
      }
      transitions.add(sessionId);
      try {
        sessionStore.clearSession();
        clearRuntime(sessionId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          code: "dismiss-failed",
          error: error instanceof Error ? error.message : "Could not dismiss recording recovery",
        };
      } finally {
        transitions.delete(sessionId);
      }
    },
    async openCompletedRecording(sessionId) {
      return outcomes.open(sessionId);
    },
    async showCompletedRecording(sessionId) {
      return outcomes.show(sessionId);
    },
    async dismissNotice(sessionId) {
      return outcomes.dismiss(sessionId)
        ? { success: true }
        : { success: false, error: "Recording outcome not found" };
    },
  };
}
