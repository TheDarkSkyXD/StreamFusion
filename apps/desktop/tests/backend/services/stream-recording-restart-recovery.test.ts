import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStreamRecordingService } from "@backend/services/stream-recording-service";
import { createStreamRecordingSessionStore } from "@backend/services/stream-recording-session-store";
import type {
  LegacyStreamRecordingJournalV1,
  StreamRecordingJournalV2,
  StreamRecordingQuality,
  StreamRecordingSession,
} from "@shared/stream-recording-types";

const source: StreamRecordingQuality = {
  quality: "Source",
  url: "https://cdn.example/source.m3u8",
  height: 1080,
  fps: 60,
  bitrate: 6_000_000,
  isSource: true,
};
const artifactIdentity = {
  algorithm: "sha256" as const,
  digest: "owned-partial-output",
  size: 120,
};

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function interruptedSession(): StreamRecordingSession {
  return {
    id: "recording-restart-1",
    streamId: "stream-live-123",
    platform: "twitch",
    channelName: "ninja",
    title: "Live",
    status: "recording",
    destinationPath: "D:/Videos/ninja-live.mp4",
    qualityLabel: "Source",
    desiredQuality: source,
    currentQuality: source,
    capturedDurationSeconds: 12,
    sections: [
      {
        id: "recording-restart-1-part-1",
        path: "D:/Videos/ninja-live.streamfusion-recording-restart-1-part-001.ts",
        startedAt: "2026-07-11T12:00:00.000Z",
      },
    ],
    gaps: [],
    createdAt: "2026-07-11T12:00:00.000Z",
    updatedAt: "2026-07-11T12:00:12.000Z",
  };
}

function recoveryHarness(
  overrides: Record<string, unknown> = {},
  seedSession: StreamRecordingSession = interruptedSession()
) {
  let journal: LegacyStreamRecordingJournalV1 | StreamRecordingJournalV2 = {
    version: 1,
    session: seedSession,
  };
  const save = vi.fn((next: StreamRecordingJournalV2) => {
    journal = structuredClone(next);
  });
  const store = createStreamRecordingSessionStore({
    storage: {
      getStreamRecordingJournal: () => journal,
      saveStreamRecordingJournal: save,
    },
  });
  const done = new Promise<never>(() => undefined);
  const dependencies = {
    sessionStore: store,
    resolvePlayback: vi.fn(async () => ({
      url: "master",
      format: "hls",
      streamId: "stream-live-123",
    })),
    resolveQualityCatalog: vi.fn(async () => [source]),
    chooseQuality: vi.fn(),
    chooseSavePath: vi.fn(),
    getAvailablePath: (candidate: string) => candidate,
    resolveFfmpegPath: () => "ffmpeg",
    createSectionPath: (_destination: string, index: number, sessionId: string) =>
      `D:/Videos/ninja-live.streamfusion-${sessionId}-part-${String(index).padStart(3, "0")}.ts`,
    now: vi
      .fn()
      .mockReturnValueOnce("2026-07-11T12:05:01.000Z")
      .mockReturnValue("2026-07-11T12:05:02.000Z"),
    startRecorder: vi.fn(() => ({
      stop: vi.fn(),
      done,
    })),
    isRecordingSectionAvailable: vi.fn(async () => true),
    ...overrides,
  };
  return {
    store,
    save,
    dependencies,
    service: createStreamRecordingService(dependencies),
  };
}

// Guards: startup recovery is inert until the user explicitly chooses Resume or Finalize Partial.
// Guards: Resume keeps earlier TS sections, closes the restart gap, and starts a new TS section at the cumulative baseline.
// Guards: Resume rejects missing, unreadable, or symlinked preserved sections before playback or recorder mutation.
// Guards: Finalize revalidates section evidence at action time and persistence failures stay typed and retryable.
describe("Stream Recording restart recovery", () => {
  it("does no automatic work and resumes the same stream in a new section on explicit request", async () => {
    const harness = recoveryHarness();

    expect(harness.service.getSnapshot().active).toMatchObject({
      status: "interrupted",
      capturedDurationSeconds: 12,
      gapCount: 1,
    });
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.dependencies.resolvePlayback).not.toHaveBeenCalled();
    expect(harness.dependencies.startRecorder).not.toHaveBeenCalled();

    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: true,
    });

    expect(harness.dependencies.resolvePlayback).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "twitch",
        channelName: "ninja",
      }),
      undefined,
      { forceRefresh: true }
    );
    expect(harness.dependencies.startRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        inputUrl: source.url,
        destinationPath: "D:/Videos/ninja-live.streamfusion-recording-restart-1-part-002.ts",
      })
    );
    expect(harness.store.getJournal()).toMatchObject({
      version: 2,
      state: "active",
      session: {
        status: "recording",
        capturedDurationSeconds: 12,
        sections: [{ id: "recording-restart-1-part-1" }, { id: "recording-restart-1-part-2" }],
        gaps: [{ reason: "restart", endedAt: "2026-07-11T12:05:01.000Z" }],
      },
    });
  });

  it("uses the canonical nearest quality and publishes one visible quality change", async () => {
    const quality720: StreamRecordingQuality = {
      quality: "720p60",
      url: "https://cdn.example/720.m3u8",
      height: 720,
      fps: 60,
      bitrate: 3_000_000,
    };
    const harness = recoveryHarness({
      resolveQualityCatalog: vi.fn(async () => [quality720]),
    });

    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: true,
    });

    expect(harness.dependencies.startRecorder).toHaveBeenCalledWith(
      expect.objectContaining({ inputUrl: quality720.url })
    );
    expect(harness.store.getSnapshot().active).toMatchObject({
      desiredQualityLabel: "Source",
      currentQualityLabel: "720p60",
      qualityChange: { revision: 1, fromQuality: "Source", toQuality: "720p60" },
    });
  });

  it("leaves the journal and every section intact when the same stream is unavailable", async () => {
    const harness = recoveryHarness({
      resolvePlayback: vi.fn(async () => {
        throw new Error("Stream is offline");
      }),
    });
    const before = structuredClone(harness.store.getJournal());

    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "stream-unavailable",
      error: "Stream is offline",
    });

    expect(harness.store.getJournal()).toEqual(before);
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.dependencies.startRecorder).not.toHaveBeenCalled();
    expect(harness.service.finalizeInterrupted).toBeTypeOf("function");
  });

  it("refuses a new Stream on the same Channel before recorder or file mutation", async () => {
    const harness = recoveryHarness({
      resolvePlayback: vi.fn(async () => ({
        url: "fresh-master",
        format: "hls",
        streamId: "stream-live-456",
      })),
    });
    const before = structuredClone(harness.store.getJournal());

    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "stream-changed",
      error: "This Channel is now showing a different Stream",
    });

    expect(harness.store.getJournal()).toEqual(before);
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.dependencies.resolveQualityCatalog).not.toHaveBeenCalled();
    expect(harness.dependencies.startRecorder).not.toHaveBeenCalled();
  });

  it("keeps a legacy recovery without Stream identity Finalize-only", async () => {
    const legacy = interruptedSession();
    delete legacy.streamId;
    const harness = recoveryHarness({}, legacy);

    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "finalize-required",
      error:
        "This legacy recording cannot verify the same Stream. Finalize the partial recording instead.",
    });

    expect(harness.dependencies.resolvePlayback).not.toHaveBeenCalled();
    expect(harness.dependencies.startRecorder).not.toHaveBeenCalled();
    expect(harness.store.getJournal().session?.id).toBe("recording-restart-1");
  });

  it("keeps recovery untouched when any preserved section is no longer safely readable", async () => {
    const session = interruptedSession();
    session.sections[0].endedAt = "2026-07-11T12:00:06.000Z";
    session.sections.push({
      id: "recording-restart-1-part-2",
      path: "D:/Videos/ninja-live.streamfusion-recording-restart-1-part-002.ts",
      startedAt: "2026-07-11T12:00:06.000Z",
      endedAt: "2026-07-11T12:00:12.000Z",
    });
    const isRecordingSectionAvailable = vi
      .fn<(path: string) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const harness = recoveryHarness({ isRecordingSectionAvailable }, session);
    const before = structuredClone(harness.store.getJournal());

    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "resume-failed",
      error: "A preserved recording section is no longer available or safely readable",
    });

    expect(isRecordingSectionAvailable).toHaveBeenCalledTimes(2);
    expect(harness.dependencies.resolvePlayback).not.toHaveBeenCalled();
    expect(harness.dependencies.startRecorder).not.toHaveBeenCalled();
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.store.getJournal()).toEqual(before);
    await expect(harness.service.dismissInterrupted("recording-restart-1", false)).resolves.toEqual(
      {
        success: false,
        code: "confirmation-required",
        error: "Confirmation is required",
      }
    );
    expect(harness.store.getJournal()).toEqual(before);
  });

  it.each([
    "commit-intent",
    "pending-probe",
  ] as const)("requires Finalize Partial instead of resuming a %s checkpoint", async (state) => {
    const checkpointed = interruptedSession();
    checkpointed.status = "finalizing";
    checkpointed.recoveryExhaustion = {
      state,
      error: "Recording interrupted during finalization",
      outputPath: "D:/Videos/ninja-live.mp4",
      outputFormat: "mp4",
      usedFallback: false,
      artifactIdentity,
    };
    const harness = recoveryHarness({}, checkpointed);
    const before = structuredClone(harness.store.getJournal());

    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "finalize-required",
      error:
        "This recording has already started finalizing. Finalize the partial recording instead.",
    });

    expect(harness.store.getJournal()).toEqual(before);
    expect(harness.dependencies.resolvePlayback).not.toHaveBeenCalled();
    expect(harness.dependencies.startRecorder).not.toHaveBeenCalled();
  });

  it("rolls back the recovery attempt when the new recorder cannot spawn", async () => {
    const harness = recoveryHarness({
      startRecorder: vi.fn(() => {
        throw new Error("ffmpeg spawn failed");
      }),
    });
    const before = structuredClone(harness.store.getJournal());

    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "resume-failed",
      error: "ffmpeg spawn failed",
    });

    expect(harness.store.getJournal()).toEqual(before);
    expect(harness.save).not.toHaveBeenCalled();
  });

  it("waits for the spawned recorder to finish before cleaning up a failed Preparing save", async () => {
    let journal: StreamRecordingJournalV2 = {
      version: 2,
      state: "active",
      session: interruptedSession(),
    };
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (next.session?.status === "preparing") {
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    let finishRecorder: (result: { outputPath: string; format: "ts"; partial: boolean }) => void =
      () => undefined;
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      finishRecorder = resolve;
    });
    const stop = vi.fn(() => done);
    const cleanupAbortedSection = vi.fn(async () => undefined);
    const service = createStreamRecordingService({
      sessionStore: store,
      resolvePlayback: vi.fn(async () => ({
        url: "master",
        format: "hls",
        streamId: "stream-live-123",
      })),
      resolveQualityCatalog: vi.fn(async () => [source]),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      now: vi
        .fn()
        .mockReturnValueOnce("2026-07-11T12:05:01.000Z")
        .mockReturnValue("2026-07-11T12:05:02.000Z"),
      startRecorder: vi.fn(() => ({ stop, done })),
      cleanupAbortedSection,
      isRecordingSectionAvailable: vi.fn(async () => true),
    });
    let settled = false;

    const resuming = service.resumeInterrupted("recording-restart-1").finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));

    expect(settled).toBe(false);
    expect(cleanupAbortedSection).not.toHaveBeenCalled();

    finishRecorder({
      outputPath: "D:/Videos/ninja-live.streamfusion-recording-restart-1-part-002.ts",
      format: "ts",
      partial: true,
    });
    await expect(resuming).resolves.toEqual({
      success: false,
      code: "resume-failed",
      error: "journal disk full",
    });
    expect(cleanupAbortedSection).toHaveBeenCalledWith(
      "D:\\Videos\\ninja-live.streamfusion-recording-restart-1-part-002.ts"
    );
  });

  it("removes a nonempty unjournaled section only after its failed recovery writer closes", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-recovery-orphan-"));
    temporaryDirectories.push(directory);
    const seed = interruptedSession();
    seed.destinationPath = path.join(directory, "ninja-live.mp4");
    seed.sections[0].path = path.join(
      directory,
      "ninja-live.streamfusion-recording-restart-1-part-001.ts"
    );
    writeFileSync(seed.sections[0].path, "preserved-section");
    let journal: StreamRecordingJournalV2 = { version: 2, state: "active", session: seed };
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (next.session?.status === "preparing") throw new Error("journal disk full");
          journal = structuredClone(next);
        },
      },
    });
    let spawnedPath = "";
    let closeWriter: () => void = () => undefined;
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      closeWriter = () => resolve({ outputPath: spawnedPath, format: "ts", partial: true });
    });
    const stop = vi.fn(() => {
      closeWriter();
      return done;
    });
    const service = createStreamRecordingService({
      ...recoveryHarness().dependencies,
      sessionStore: store,
      createSectionPath: undefined,
      startRecorder: vi.fn((input) => {
        spawnedPath = input.destinationPath;
        writeFileSync(spawnedPath, "captured-but-unjournaled");
        return { stop, done };
      }),
      isRecordingSectionAvailable: undefined,
    });

    await expect(service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "resume-failed",
      error: "journal disk full",
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(existsSync(spawnedPath)).toBe(false);
    expect(existsSync(seed.sections[0].path)).toBe(true);
  });

  it("keeps newly allocated recovery sections canonical even when generic path allocation suggests a suffix", async () => {
    const harness = recoveryHarness({
      getAvailablePath: (candidate: string) =>
        candidate.toLowerCase().endsWith(".mp4") ? candidate : `${candidate}.conflict`,
    });

    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: true,
    });

    expect(harness.dependencies.startRecorder).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationPath: "D:/Videos/ninja-live.streamfusion-recording-restart-1-part-002.ts",
      })
    );
  });

  it("stops the new recorder and restores Interrupted when the post-spawn Recording save fails", async () => {
    let journal: StreamRecordingJournalV2 = {
      version: 2,
      state: "active",
      session: interruptedSession(),
    };
    let failRecordingSave = true;
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (next.session?.status === "recording" && failRecordingSave) {
            failRecordingSave = false;
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    const stop = vi.fn(async () => ({
      outputPath: "D:/Videos/ninja-live.streamfusion-recording-restart-1-part-002.ts",
      format: "ts" as const,
      partial: true,
    }));
    const cleanupAbortedSection = vi.fn(async () => undefined);
    const service = createStreamRecordingService({
      sessionStore: store,
      resolvePlayback: vi.fn(async () => ({
        url: "master",
        format: "hls",
        streamId: "stream-live-123",
      })),
      resolveQualityCatalog: vi.fn(async () => [source]),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      now: vi
        .fn()
        .mockReturnValueOnce("2026-07-11T12:05:01.000Z")
        .mockReturnValue("2026-07-11T12:05:02.000Z"),
      startRecorder: vi.fn(() => ({ stop, done: new Promise<never>(() => undefined) })),
      cleanupAbortedSection,
      isRecordingSectionAvailable: vi.fn(async () => true),
    });

    await expect(service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "resume-failed",
      error: "journal disk full",
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(cleanupAbortedSection).toHaveBeenCalledWith(
      "D:\\Videos\\ninja-live.streamfusion-recording-restart-1-part-002.ts"
    );
    expect(store.getJournal()).toMatchObject({
      state: "interrupted",
      session: {
        status: "interrupted",
        capturedDurationSeconds: 12,
        sections: [{ id: "recording-restart-1-part-1" }],
        gaps: [{ reason: "restart" }],
        desiredQuality: { quality: "Source" },
        currentQuality: { quality: "Source" },
      },
    });
  });

  it("serializes recovery actions so Resume cannot race a second user command", async () => {
    let resolvePlayback: (value: { url: string; format: string; streamId: string }) => void = () =>
      undefined;
    const pendingPlayback = new Promise<{ url: string; format: string; streamId: string }>(
      (resolve) => {
        resolvePlayback = resolve;
      }
    );
    const harness = recoveryHarness({
      resolvePlayback: vi.fn(() => pendingPlayback),
    });

    const first = harness.service.resumeInterrupted("recording-restart-1");
    await expect(harness.service.resumeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "busy",
      error: "Recording is busy",
    });
    resolvePlayback({ url: "master", format: "hls", streamId: "stream-live-123" });
    await expect(first).resolves.toEqual({ success: true });
  });

  it("finalizes every preserved section offline and clears the journal only after durable success", async () => {
    const finalize = vi.fn(async ({ sections, beforeCommit }) => {
      await beforeCommit?.({
        outputPath: "D:/Videos/ninja-live.mp4",
        format: "mp4" as const,
        usedFallback: false,
        artifactIdentity,
      });
      return {
        outputPath: "D:/Videos/ninja-live.mp4",
        format: "mp4" as const,
        usedFallback: false,
        ownedSectionPaths: sections.map((section: { path: string }) => section.path),
        artifactIdentity,
      };
    });
    const harness = recoveryHarness({
      sectionFinalizer: { finalize },
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
      cleanupSections: vi.fn(async () => undefined),
      recordingFileActions: {
        exists: vi.fn(() => false),
        openPath: vi.fn(),
        showItemInFolder: vi.fn(),
      },
    });
    const phases: string[] = [];
    harness.store.subscribe((snapshot) => {
      if (snapshot.active) phases.push(snapshot.active.status);
    });

    await expect(harness.service.finalizeInterrupted("recording-restart-1")).resolves.toEqual({
      success: true,
    });

    expect(harness.dependencies.resolvePlayback).not.toHaveBeenCalled();
    expect(harness.dependencies.startRecorder).not.toHaveBeenCalled();
    expect(phases).toContain("finalizing");
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationPath: "D:\\Videos\\ninja-live.mp4",
        sections: [
          expect.objectContaining({
            id: "recording-restart-1-part-1",
            path: "D:/Videos/ninja-live.streamfusion-recording-restart-1-part-001.ts",
          }),
        ],
        beforeCommit: expect.any(Function),
      })
    );
    expect(harness.store.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(harness.service.getSnapshot().notice).toMatchObject({
      outcome: "partial",
      outputPath: "D:/Videos/ninja-live.mp4",
      artifactIdentity,
    });
  });

  it("revalidates preserved sections at Finalize action time before invoking ffmpeg", async () => {
    const finalize = vi.fn();
    const harness = recoveryHarness({
      isRecordingSectionAvailable: vi.fn(async () => false),
      sectionFinalizer: { finalize },
    });

    await expect(harness.service.finalizeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "finalize-failed",
      error: "A preserved recording section is no longer available or safely readable",
    });

    expect(finalize).not.toHaveBeenCalled();
    expect(harness.store.getJournal()).toMatchObject({
      state: "interrupted",
      session: { status: "interrupted", sections: [{ id: "recording-restart-1-part-1" }] },
    });
  });

  it("returns a typed Finalize failure and releases its lock when recovery persistence stays unavailable", async () => {
    const journal: StreamRecordingJournalV2 = {
      version: 2,
      state: "active",
      session: interruptedSession(),
    };
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: () => {
          throw new Error("journal disk full");
        },
      },
    });
    const service = createStreamRecordingService({
      ...recoveryHarness().dependencies,
      sessionStore: store,
    });

    await expect(service.finalizeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "finalize-failed",
      error: "journal disk full",
    });
    await expect(service.dismissInterrupted("recording-restart-1", false)).resolves.toEqual({
      success: false,
      code: "confirmation-required",
      error: "Confirmation is required",
    });
    expect(journal.session?.id).toBe("recording-restart-1");
  });

  it("preserves the recovery journal and TS evidence when Finalize Partial fails", async () => {
    const cleanupSections = vi.fn();
    const harness = recoveryHarness({
      sectionFinalizer: {
        finalize: vi.fn(async () => {
          throw new Error("Could not assemble sections");
        }),
      },
      cleanupSections,
      cleanupFailedArtifact: vi.fn(),
    });

    await expect(harness.service.finalizeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "finalize-failed",
      error: "Could not assemble sections",
    });

    expect(harness.store.getJournal()).toMatchObject({
      state: "interrupted",
      session: {
        id: "recording-restart-1",
        status: "interrupted",
        sections: [
          expect.objectContaining({
            path: "D:/Videos/ninja-live.streamfusion-recording-restart-1-part-001.ts",
          }),
        ],
        statusMessage: "Could not assemble sections",
      },
    });
    expect(cleanupSections).not.toHaveBeenCalled();
    expect(harness.service.getSnapshot().notice).toBeNull();
  });

  it.each([
    "commit-intent",
    "pending-probe",
  ] as const)("re-probes a verified %s artifact after restart without finalizing twice", async (state) => {
    const session = interruptedSession();
    session.status = "finalizing";
    session.recoveryExhaustion = {
      state,
      error: "Recording interrupted when StreamFusion closed",
      outputPath: "D:/Videos/ninja-live.mp4",
      outputFormat: "mp4",
      usedFallback: false,
      artifactIdentity,
    };
    const finalize = vi.fn();
    const probeArtifact = vi.fn(async () => true);
    const harness = recoveryHarness(
      {
        sectionFinalizer: { finalize },
        probeArtifact,
        verifyArtifactIdentity: vi.fn(async () => true),
        cleanupSections: vi.fn(async () => undefined),
        recordingFileActions: {
          exists: vi.fn(() => true),
          openPath: vi.fn(),
          showItemInFolder: vi.fn(),
        },
      },
      session
    );

    expect(harness.service.getSnapshot().active).toMatchObject({
      status: "interrupted",
      recoveryFinalizeOnly: true,
    });

    await expect(harness.service.finalizeInterrupted("recording-restart-1")).resolves.toEqual({
      success: true,
    });

    expect(finalize).not.toHaveBeenCalled();
    expect(probeArtifact).toHaveBeenCalledWith({
      ffmpegPath: "ffmpeg",
      outputPath: "D:/Videos/ninja-live.mp4",
    });
    expect(harness.service.getSnapshot().notice).toMatchObject({ outcome: "partial" });
  });

  it("reuses a verified committed output from normal finalization after restart", async () => {
    const session = interruptedSession();
    session.status = "finalizing";
    session.committedOutputPath = "D:/Videos/ninja-live.mp4";
    session.committedArtifactIdentity = artifactIdentity;
    session.outputFormat = "mp4";
    session.usedFallback = false;
    const finalize = vi.fn();
    const probeArtifact = vi.fn(async () => true);
    const cleanupSections = vi.fn(async () => undefined);
    const harness = recoveryHarness(
      {
        sectionFinalizer: { finalize },
        probeArtifact,
        verifyArtifactIdentity: vi.fn(async () => true),
        cleanupSections,
        recordingFileActions: {
          exists: vi.fn(() => true),
          openPath: vi.fn(),
          showItemInFolder: vi.fn(),
        },
      },
      session
    );

    expect(harness.service.getSnapshot().active).toMatchObject({
      status: "interrupted",
      recoveryFinalizeOnly: true,
    });

    await expect(harness.service.finalizeInterrupted("recording-restart-1")).resolves.toEqual({
      success: true,
    });

    expect(finalize).not.toHaveBeenCalled();
    expect(probeArtifact).toHaveBeenCalledWith({
      ffmpegPath: "ffmpeg",
      outputPath: "D:/Videos/ninja-live.mp4",
    });
    expect(cleanupSections).toHaveBeenCalledWith([
      "D:/Videos/ninja-live.streamfusion-recording-restart-1-part-001.ts",
    ]);
    expect(harness.store.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(harness.service.getSnapshot().notice).toMatchObject({
      outcome: "partial",
      outputPath: "D:/Videos/ninja-live.mp4",
      artifactIdentity,
    });
  });

  it("requires explicit confirmation to dismiss recovery and never deletes captured files", async () => {
    const cleanupSections = vi.fn();
    const cleanupFailedArtifact = vi.fn();
    const harness = recoveryHarness({ cleanupSections, cleanupFailedArtifact });

    await expect(harness.service.dismissInterrupted("recording-restart-1", false)).resolves.toEqual(
      { success: false, code: "confirmation-required", error: "Confirmation is required" }
    );
    expect(harness.store.getJournal().session?.id).toBe("recording-restart-1");

    await expect(harness.service.dismissInterrupted("recording-restart-1", true)).resolves.toEqual({
      success: true,
    });
    expect(harness.store.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(cleanupSections).not.toHaveBeenCalled();
    expect(cleanupFailedArtifact).not.toHaveBeenCalled();
  });

  it("returns a typed Dismiss failure and keeps recovery when journal clear cannot persist", async () => {
    let journal: StreamRecordingJournalV2 = {
      version: 2,
      state: "active",
      session: interruptedSession(),
    };
    const store = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (!next.session) throw new Error("journal disk full");
          journal = structuredClone(next);
        },
      },
    });
    const service = createStreamRecordingService({
      ...recoveryHarness().dependencies,
      sessionStore: store,
    });

    await expect(service.dismissInterrupted("recording-restart-1", true)).resolves.toEqual({
      success: false,
      code: "dismiss-failed",
      error: "journal disk full",
    });
    expect(service.getSnapshot().active).toMatchObject({
      sessionId: "recording-restart-1",
      status: "interrupted",
    });
  });

  it("never finalizes or deletes an arbitrary TS path from a tampered journal", async () => {
    const tampered = interruptedSession();
    tampered.sections[0].path = "D:/Videos/unrelated.ts";
    const finalize = vi.fn();
    const cleanupSections = vi.fn();
    const cleanupFailedArtifact = vi.fn();
    const harness = recoveryHarness(
      {
        sectionFinalizer: { finalize },
        cleanupSections,
        cleanupFailedArtifact,
      },
      tampered
    );

    expect(harness.service.getSnapshot()).toEqual({ active: null, notice: null });
    await expect(harness.service.finalizeInterrupted("recording-restart-1")).resolves.toEqual({
      success: false,
      code: "not-found",
      error: "Interrupted recording session not found",
    });
    expect(finalize).not.toHaveBeenCalled();
    expect(cleanupSections).not.toHaveBeenCalled();
    expect(cleanupFailedArtifact).not.toHaveBeenCalled();
  });
});
