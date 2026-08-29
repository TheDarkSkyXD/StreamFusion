import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const downloadQueueSpies = vi.hoisted(() => ({
  getService: vi.fn(),
  enqueue: vi.fn(),
  start: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  updateTarget: vi.fn(),
  updateProgress: vi.fn(),
}));

vi.mock("@backend/services/download-queue-service", () => ({
  getDownloadQueueService: () => {
    downloadQueueSpies.getService();
    return downloadQueueSpies;
  },
}));

import { createOwnedRecordingSectionPath } from "@backend/services/stream-recording-paths";
import { createStreamRecordingService } from "@backend/services/stream-recording-service";
import { createStreamRecordingSessionStore } from "@backend/services/stream-recording-session-store";
import type {
  StreamRecordingJournal,
  StreamRecordingQuality,
  StreamRecordingSession,
} from "@shared/stream-recording-types";

type RecorderInput = Parameters<
  Parameters<typeof createStreamRecordingService>[0]["startRecorder"]
>[0];

function createStore(seed: StreamRecordingJournal = { version: 1, session: null }) {
  let journal: StreamRecordingJournal = seed;
  return createStreamRecordingSessionStore({
    storage: {
      getStreamRecordingJournal: () => journal,
      saveStreamRecordingJournal: (next) => {
        journal = structuredClone(next);
      },
    },
  });
}

function deferredRecorder() {
  let reject: (error: Error) => void = () => {};
  const done = new Promise<never>((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });
  return {
    recorder: {
      stop: vi.fn(async () => ({ outputPath: "section.ts", format: "ts" as const, partial: true })),
      done,
    },
    reject,
  };
}

const source: StreamRecordingQuality = {
  quality: "Source",
  url: "https://cdn.example/source.m3u8",
  height: 1080,
  fps: 60,
  bitrate: 6_000_000,
  isSource: true,
};
const quality720: StreamRecordingQuality = {
  quality: "720p60",
  url: "https://cdn.example/720.m3u8",
  height: 720,
  fps: 60,
  bitrate: 3_000_000,
  isSource: false,
};
const sourceMetadata: StreamRecordingQuality = {
  quality: "Source",
  height: 1080,
  fps: 60,
  bitrate: 6_000_000,
  isSource: true,
};
const quality720Metadata: StreamRecordingQuality = {
  quality: "720p60",
  height: 720,
  fps: 60,
  bitrate: 3_000_000,
  isSource: false,
};
const ownedIdentity = {
  algorithm: "sha256" as const,
  digest: "owned-artifact-digest",
  size: 15,
};

function ownedSectionPath(destinationPath: string, sectionNumber: number, sessionId: string) {
  return createOwnedRecordingSectionPath(destinationPath, sessionId, sectionNumber);
}

function exhaustionCrashSession(
  directory: string,
  exhaustion: NonNullable<StreamRecordingSession["recoveryExhaustion"]>
): StreamRecordingSession {
  return {
    id: "recording-1",
    platform: "twitch",
    channelName: "ninja",
    title: "Live",
    status: "finalizing",
    destinationPath: path.join(directory, "recording.mp4"),
    qualityLabel: "Source",
    desiredQuality: sourceMetadata,
    currentQuality: sourceMetadata,
    qualityChange: null,
    capturedDurationSeconds: 12,
    sections: [
      {
        id: "recording-1-part-1",
        path: ownedSectionPath(path.join(directory, "recording.mp4"), 1, "recording-1"),
        startedAt: "2026-07-11T12:00:00.000Z",
        endedAt: "2026-07-11T12:00:12.000Z",
      },
    ],
    gaps: [{ startedAt: "2026-07-11T12:00:12.000Z", reason: "reconnect" }],
    createdAt: "2026-07-11T12:00:00.000Z",
    updatedAt: "2026-07-11T12:05:12.000Z",
    partial: true,
    recoveryExhaustion: exhaustion,
  };
}

const temporaryDirectories: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const spy of Object.values(downloadQueueSpies)) spy.mockClear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Guards: recorder loss freezes captured time, opens one reconnect gap, and resumes in a new TS section.
// Guards: recovery keeps the desired quality or reports one typed quality-change revision on fallback.
// Guards: stale or exhausted recovery cannot restart capture and never creates Downloads history.
// Guards: reconnect force-refreshes Stream identity and never splices capture across broadcasts.
describe("Stream Recording reconnect recovery", () => {
  it("retains exact quality and resumes cumulative capture in a new section", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
    const store = createStore();
    const first = deferredRecorder();
    const second = deferredRecorder();
    const inputs: RecorderInput[] = [];
    const resolveQualityCatalog = vi.fn(async () => [source, quality720]);
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/master.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      resolveQualityCatalog,
      chooseQuality: vi.fn(async () => source),
      chooseSavePath: vi.fn(async () => "D:/Videos/recording.mp4"),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn((input) => {
        inputs.push(input);
        return inputs.length === 1 ? first.recorder : second.recorder;
      }),
      monotonicNow: () => Date.now(),
      reconnectBackoffMs: [1000],
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    inputs[0].onProgress({ elapsedSeconds: 12 });
    first.reject(new Error("socket lost"));
    await vi.waitFor(() => expect(service.getSnapshot().active?.status).toBe("reconnecting"));
    inputs[0].onProgress({ elapsedSeconds: 99 });
    expect(service.getSnapshot().active?.capturedDurationSeconds).toBe(12);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(service.getSnapshot().active?.status).toBe("recording"));
    inputs[1].onProgress({ elapsedSeconds: 3 });

    expect(inputs.map((input) => [input.destinationPath, input.inputUrl])).toEqual([
      [ownedSectionPath("D:/Videos/recording.mp4", 1, "recording-1"), source.url],
      [ownedSectionPath("D:/Videos/recording.mp4", 2, "recording-1"), source.url],
    ]);
    expect(store.getJournal().session).toMatchObject({
      desiredQuality: sourceMetadata,
      currentQuality: sourceMetadata,
      qualityLabel: "Source",
      qualityChange: null,
      capturedDurationSeconds: 15,
      sections: [
        {
          path: ownedSectionPath("D:/Videos/recording.mp4", 1, "recording-1"),
          endedAt: expect.any(String),
        },
        { path: ownedSectionPath("D:/Videos/recording.mp4", 2, "recording-1") },
      ],
      gaps: [{ reason: "reconnect", endedAt: expect.any(String) }],
    });
    expect(Object.values(downloadQueueSpies).every((spy) => spy.mock.calls.length === 0)).toBe(
      true
    );
    vi.useRealTimers();
  });

  it("terminates reconnect when the Channel now exposes a different Stream before spawning", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const first = deferredRecorder();
    const resolvePlayback = vi
      .fn()
      .mockResolvedValueOnce({ url: "master-1", format: "hls", streamId: "stream-live-123" })
      .mockResolvedValueOnce({ url: "master-2", format: "hls", streamId: "stream-live-456" });
    const resolveQualityCatalog = vi.fn(async () => [source]);
    const startRecorder = vi.fn(() => first.recorder);
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback,
      resolveQualityCatalog,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:/Videos/recording.mp4"),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
      monotonicNow: () => Date.now(),
      reconnectBackoffMs: [1000],
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    first.reject(new Error("socket lost"));
    await vi.waitFor(() => expect(service.getSnapshot().active?.status).toBe("reconnecting"));

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(service.getSnapshot().active).toBeNull());

    expect(resolvePlayback).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ streamId: "stream-live-123" }),
      expect.any(AbortSignal),
      { forceRefresh: true }
    );
    expect(resolveQualityCatalog).toHaveBeenCalledTimes(1);
    expect(startRecorder).toHaveBeenCalledTimes(1);
  });

  it("keeps desired quality immutable and publishes one revision when fallback changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
    const store = createStore();
    const first = deferredRecorder();
    const second = deferredRecorder();
    const catalogs = vi
      .fn()
      .mockResolvedValueOnce([source, quality720])
      .mockResolvedValue([quality720]);
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/master.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      resolveQualityCatalog: catalogs,
      chooseQuality: vi.fn(async () => source),
      chooseSavePath: vi.fn(async () => "D:/Videos/recording.mp4"),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn().mockReturnValueOnce(first.recorder).mockReturnValue(second.recorder),
      monotonicNow: () => Date.now(),
      reconnectBackoffMs: [1000],
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    first.reject(new Error("socket lost"));
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getSnapshot().active?.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(service.getSnapshot().active?.status).toBe("recording"));

    expect(store.getJournal().session).toMatchObject({
      desiredQuality: sourceMetadata,
      currentQuality: quality720Metadata,
      qualityLabel: "720p60",
      qualityChange: { revision: 1, fromQuality: "Source", toQuality: "720p60" },
    });
    expect(service.getSnapshot().active).toMatchObject({
      desiredQualityLabel: "Source",
      currentQualityLabel: "720p60",
      qualityChange: { revision: 1, fromQuality: "Source", toQuality: "720p60" },
    });
    vi.useRealTimers();
  });

  it("rolls back every quality and section field when the first reconnect recorder spawn fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
    const store = createStore();
    const first = deferredRecorder();
    const recovered = deferredRecorder();
    let reconnectRecorderCreated = false;
    const snapshots: Array<{
      snapshot: ReturnType<typeof store.getSnapshot>;
      reconnectRecorderCreated: boolean;
    }> = [];
    store.subscribe((snapshot) =>
      snapshots.push({
        snapshot: structuredClone(snapshot),
        reconnectRecorderCreated,
      })
    );
    const startRecorder = vi
      .fn()
      .mockReturnValueOnce(first.recorder)
      .mockImplementationOnce(() => {
        throw new Error("ffmpeg spawn race");
      })
      .mockImplementation(() => {
        reconnectRecorderCreated = true;
        return recovered.recorder;
      });
    const catalogs = vi.fn().mockResolvedValueOnce([source]).mockResolvedValue([quality720]);
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "master",
        format: "hls",
        streamId: "stream-live-123",
      })),
      resolveQualityCatalog: catalogs,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:/Videos/recording.mp4"),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
      monotonicNow: () => Date.now(),
      reconnectBackoffMs: [1000],
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    first.reject(new Error("socket lost"));
    await vi.advanceTimersByTimeAsync(1000);

    expect(store.getJournal().session).toMatchObject({
      status: "reconnecting",
      statusMessage: "Reconnecting",
      desiredQuality: sourceMetadata,
      currentQuality: sourceMetadata,
      qualityLabel: "Source",
      qualityChange: null,
      sections: [
        {
          path: ownedSectionPath("D:/Videos/recording.mp4", 1, "recording-1"),
          endedAt: expect.any(String),
        },
      ],
      gaps: [{ reason: "reconnect" }],
    });
    expect(snapshots.at(-1)?.snapshot.active).toMatchObject({
      status: "reconnecting",
      desiredQualityLabel: "Source",
      currentQualityLabel: "Source",
      qualityLabel: "Source",
      qualityChange: null,
    });
    expect(
      snapshots.filter(
        ({ snapshot, reconnectRecorderCreated: created }) =>
          !created &&
          (snapshot.active?.currentQualityLabel === "720p60" ||
            snapshot.active?.qualityChange?.revision === 1)
      )
    ).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getJournal().session).toMatchObject({
      status: "recording",
      desiredQuality: sourceMetadata,
      currentQuality: quality720Metadata,
      qualityLabel: "720p60",
      qualityChange: { revision: 1, fromQuality: "Source", toQuality: "720p60" },
      sections: [
        { path: ownedSectionPath("D:/Videos/recording.mp4", 1, "recording-1") },
        { path: ownedSectionPath("D:/Videos/recording.mp4", 2, "recording-1") },
      ],
    });
    const announcementSnapshots = snapshots.filter(
      ({ snapshot }) => snapshot.active?.qualityChange?.revision === 1
    );
    expect(announcementSnapshots.length).toBeGreaterThan(0);
    expect(announcementSnapshots.every(({ reconnectRecorderCreated: created }) => created)).toBe(
      true
    );
  });

  it("uses the same desired-quality fallback contract when a paused capture resumes", async () => {
    const store = createStore();
    const first = deferredRecorder();
    const second = deferredRecorder();
    const inputs: RecorderInput[] = [];
    const catalogs = vi
      .fn()
      .mockResolvedValueOnce([source, quality720])
      .mockResolvedValue([quality720]);
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/master.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      resolveQualityCatalog: catalogs,
      chooseQuality: vi.fn(async () => source),
      chooseSavePath: vi.fn(async () => "D:/Videos/recording.mp4"),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn((input) => {
        inputs.push(input);
        return inputs.length === 1 ? first.recorder : second.recorder;
      }),
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    await service.pauseRecording("recording-1");
    await service.resumeRecording("recording-1");

    expect(inputs[1].inputUrl).toBe(quality720.url);
    expect(store.getJournal().session).toMatchObject({
      desiredQuality: sourceMetadata,
      currentQuality: quality720Metadata,
      qualityChange: { revision: 1, fromQuality: "Source", toQuality: "720p60" },
    });
  });

  it("uses the full five-minute deadline then emits Partial only after playable output is probed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-recovery-"));
    temporaryDirectories.push(directory);
    const destinationPath = path.join(directory, "recording.mp4");
    const sectionPath = ownedSectionPath(destinationPath, 1, "recording-1");
    const outputBytes = Buffer.from("captured-section-bytes");
    const store = createStore();
    const first = deferredRecorder();
    const resolvePlayback = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://cdn.example/master.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })
      .mockRejectedValue(new Error("still offline"));
    const finalize = vi.fn(
      async ({
        sections,
        beforeCommit,
      }: {
        sections: Array<{ path: string }>;
        beforeCommit?: (intent: {
          outputPath: string;
          format: "mp4";
          usedFallback: false;
          artifactIdentity: typeof ownedIdentity;
        }) => Promise<void>;
      }) => {
        expect(store.getJournal().session?.recoveryExhaustion).toEqual({
          state: "finalizing",
          error: "still offline",
        });
        expect(readFileSync(sections[0].path)).toEqual(outputBytes);
        await beforeCommit?.({
          outputPath: destinationPath,
          format: "mp4",
          usedFallback: false,
          artifactIdentity: ownedIdentity,
        });
        expect(store.getJournal().session?.recoveryExhaustion).toMatchObject({
          state: "commit-intent",
          outputPath: destinationPath,
          artifactIdentity: ownedIdentity,
        });
        writeFileSync(destinationPath, outputBytes, { flag: "wx" });
        return {
          outputPath: destinationPath,
          format: "mp4" as const,
          usedFallback: false,
          ownedSectionPaths: sections.map((section) => section.path),
          artifactIdentity: ownedIdentity,
        };
      }
    );
    const probeArtifact = vi.fn(async ({ outputPath }: { outputPath: string }) => {
      expect(store.getJournal().session?.recoveryExhaustion).toEqual({
        state: "pending-probe",
        error: "still offline",
        outputPath: destinationPath,
        outputFormat: "mp4",
        usedFallback: false,
        artifactIdentity: ownedIdentity,
      });
      return readFileSync(outputPath).equals(outputBytes);
    });
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback,
      resolveQualityCatalog: vi.fn(async () => [source]),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => destinationPath),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => {
        writeFileSync(sectionPath, outputBytes, { flag: "wx" });
        return first.recorder;
      }),
      sectionFinalizer: { finalize },
      probeArtifact,
      verifyArtifactIdentity: vi.fn(async () => true),
      monotonicNow: () => Date.now(),
      reconnectBackoffMs: [60_000],
      reconnectWindowMs: 300_000,
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    first.reject(new Error("socket lost"));
    await vi.advanceTimersByTimeAsync(0);
    expect(service.getSnapshot().active?.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(299_999);
    expect(service.getSnapshot().active?.status).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(service.getSnapshot().active).toBeNull());

    expect(resolvePlayback).toHaveBeenCalledTimes(5);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(probeArtifact).toHaveBeenCalledWith({
      ffmpegPath: "ffmpeg",
      outputPath: destinationPath,
    });
    expect(service.getSnapshot().notice).toMatchObject({
      outcome: "partial",
      outputPath: destinationPath,
      outputFormat: "mp4",
      error: "still offline",
    });
    expect(store.getJournal().session).toBeNull();
    expect(Object.values(downloadQueueSpies).every((spy) => spy.mock.calls.length === 0)).toBe(
      true
    );
  });

  it("preserves a verified Partial immediately when stream access is removed after capture starts", async () => {
    const store = createStore();
    const first = deferredRecorder();
    const resolvePlayback = vi.fn(async () => ({
      url: "https://cdn.example/master.m3u8",
      format: "hls",
      streamId: "stream-live-123",
    }));
    const finalize = vi.fn(async () => ({
      outputPath: "D:/Videos/recording.mp4",
      format: "mp4" as const,
      usedFallback: false,
      ownedSectionPaths: [ownedSectionPath("D:/Videos/recording.mp4", 1, "recording-removed")],
      artifactIdentity: ownedIdentity,
    }));
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-removed",
      createSectionPath: ownedSectionPath,
      resolvePlayback,
      resolveQualityCatalog: vi.fn(async () => [source]),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:/Videos/recording.mp4"),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => first.recorder),
      sectionFinalizer: { finalize },
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
      isRecordingSectionAvailable: vi.fn(async () => true),
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });

    first.reject(new Error("Stream access removed"));
    await vi.waitFor(() => expect(service.getSnapshot().notice?.outcome).toBe("partial"));

    expect(resolvePlayback).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          expect.objectContaining({
            path: ownedSectionPath("D:/Videos/recording.mp4", 1, "recording-removed"),
          }),
        ],
      })
    );
    expect(service.getSnapshot().notice).toMatchObject({
      outcome: "partial",
      outputPath: "D:/Videos/recording.mp4",
      artifactIdentity: ownedIdentity,
      error: "Stream access removed",
    });
    expect(store.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(Object.values(downloadQueueSpies).every((spy) => spy.mock.calls.length === 0)).toBe(
      true
    );
  });

  it("recovers a commit-before-return crash only when the public artifact matches durable ownership", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-commit-crash-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "recording.mp4");
    writeFileSync(outputPath, "playable-output");
    const session = exhaustionCrashSession(directory, {
      state: "commit-intent",
      error: "reconnect deadline exhausted",
      outputPath,
      outputFormat: "mp4",
      usedFallback: false,
      artifactIdentity: ownedIdentity,
    });
    writeFileSync(session.sections[0].path, "staging-bytes");
    const store = createStore({ version: 1, session });
    const finalize = vi.fn();
    const probeArtifact = vi.fn(async () => true);
    const service = createStreamRecordingService({
      sessionStore: store,
      resolvePlayback: vi.fn(),
      resolveQualityCatalog: vi.fn(),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(),
      sectionFinalizer: { finalize },
      probeArtifact,
      verifyArtifactIdentity: vi.fn(async () => true),
      cleanupSections: vi.fn(async () => undefined),
      recordingFileActions: {
        exists: existsSync,
        openPath: vi.fn(async () => ""),
        showItemInFolder: vi.fn(),
      },
    });

    await expect(service.stopRecording("recording-1")).resolves.toEqual({ success: true });

    expect(finalize).not.toHaveBeenCalled();
    expect(probeArtifact).toHaveBeenCalledWith({ ffmpegPath: "ffmpeg", outputPath });
    expect(service.getSnapshot().notice).toMatchObject({
      outcome: "partial",
      outputPath,
      error: "reconnect deadline exhausted",
    });
    expect(service.getSnapshot().notice?.outcome).not.toBe("completed");
  });

  it.each([
    ["mp4", "playable-unrelated"],
    ["mp4", "unplayable-unrelated"],
    ["ts", "playable-unrelated"],
    ["ts", "unplayable-unrelated"],
  ])("never claims or deletes an unrelated %s destination containing %s during finalizing recovery", async (extension, contents) => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-unrelated-output-"));
    temporaryDirectories.push(directory);
    const session = exhaustionCrashSession(directory, {
      state: "finalizing",
      error: "reconnect deadline exhausted",
    });
    const unrelatedPath = path.join(directory, `recording.${extension}`);
    writeFileSync(unrelatedPath, contents);
    writeFileSync(session.sections[0].path, "staging-bytes");
    const store = createStore({ version: 1, session });
    const finalize = vi.fn().mockRejectedValue(new Error("no-clobber output collision"));
    const probeArtifact = vi.fn();
    const cleanupFailedArtifact = vi.fn(async () => undefined);
    const cleanupSections = vi.fn(async () => undefined);
    const verifyArtifactIdentity = vi.fn();
    const service = createStreamRecordingService({
      sessionStore: store,
      resolvePlayback: vi.fn(),
      resolveQualityCatalog: vi.fn(),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(),
      sectionFinalizer: { finalize },
      probeArtifact,
      verifyArtifactIdentity,
      cleanupFailedArtifact,
      cleanupSections,
      recordingFileActions: {
        exists: existsSync,
        openPath: vi.fn(async () => ""),
        showItemInFolder: vi.fn(),
      },
    });

    await expect(service.stopRecording("recording-1")).resolves.toMatchObject({ success: false });

    expect(finalize).toHaveBeenCalledTimes(1);
    expect(probeArtifact).not.toHaveBeenCalled();
    expect(verifyArtifactIdentity).not.toHaveBeenCalled();
    expect(cleanupFailedArtifact).not.toHaveBeenCalled();
    expect(cleanupSections).not.toHaveBeenCalled();
    expect(readFileSync(unrelatedPath, "utf8")).toBe(contents);
    expect(readFileSync(session.sections[0].path, "utf8")).toBe("staging-bytes");
    expect(service.getSnapshot().notice).toMatchObject({ outcome: "failed" });
    expect(service.getSnapshot().notice).not.toHaveProperty("outputPath");
  });

  it("recovers a journal-before-probe crash without re-finalizing or reporting Completed", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-probe-crash-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "recording.mp4");
    writeFileSync(outputPath, "unplayable-output");
    const session = exhaustionCrashSession(directory, {
      state: "pending-probe",
      error: "reconnect deadline exhausted",
      outputPath,
      outputFormat: "mp4",
      usedFallback: false,
      artifactIdentity: ownedIdentity,
    });
    session.committedOutputPath = outputPath;
    session.committedArtifactIdentity = ownedIdentity;
    session.outputFormat = "mp4";
    session.usedFallback = false;
    writeFileSync(session.sections[0].path, "staging-bytes");
    const store = createStore({ version: 1, session });
    const finalize = vi.fn();
    const service = createStreamRecordingService({
      sessionStore: store,
      resolvePlayback: vi.fn(),
      resolveQualityCatalog: vi.fn(),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(),
      sectionFinalizer: { finalize },
      probeArtifact: vi.fn(async () => false),
      verifyArtifactIdentity: vi.fn(async () => true),
      recordingFileActions: {
        exists: existsSync,
        openPath: vi.fn(async () => ""),
        showItemInFolder: vi.fn(),
      },
    });

    await expect(service.stopRecording("recording-1")).resolves.toMatchObject({ success: false });

    expect(finalize).not.toHaveBeenCalled();
    expect(service.getSnapshot().notice).toMatchObject({ outcome: "failed" });
    expect(service.getSnapshot().notice).not.toHaveProperty("outputPath");
    expect(service.getSnapshot().notice?.outcome).not.toBe("completed");
    expect(existsSync(outputPath)).toBe(false);
    expect(readFileSync(session.sections[0].path, "utf8")).toBe("staging-bytes");
  });

  it("keeps a verified Partial and its recovery journal when durable settlement fails, then retries after restart", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-partial-clear-retry-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "recording.mp4");
    const sectionPath = ownedSectionPath(outputPath, 1, "recording-1");
    writeFileSync(outputPath, "verified-partial");
    writeFileSync(sectionPath, "captured-section");
    let journal: StreamRecordingJournal = {
      version: 1,
      session: exhaustionCrashSession(directory, {
        state: "pending-probe",
        error: "stream access removed",
        outputPath,
        outputFormat: "mp4",
        usedFallback: false,
        artifactIdentity: ownedIdentity,
      }),
    };
    let failClear = true;
    const storage = {
      getStreamRecordingJournal: () => journal,
      saveStreamRecordingJournal: (next: StreamRecordingJournal) => {
        if (!next.session && failClear) {
          failClear = false;
          throw new Error("journal disk full");
        }
        journal = structuredClone(next);
      },
    };
    const cleanupSections = vi.fn(async () => undefined);
    const cleanupFailedArtifact = vi.fn(async () => undefined);
    const finalize = vi.fn();
    const createService = () =>
      createStreamRecordingService({
        sessionStore: createStreamRecordingSessionStore({ storage }),
        resolvePlayback: vi.fn(),
        chooseQuality: vi.fn(),
        chooseSavePath: vi.fn(),
        getAvailablePath: (candidate) => candidate,
        resolveFfmpegPath: () => "ffmpeg",
        startRecorder: vi.fn(),
        sectionFinalizer: { finalize },
        probeArtifact: vi.fn(async () => true),
        verifyArtifactIdentity: vi.fn(async () => true),
        cleanupSections,
        cleanupFailedArtifact,
        recordingFileActions: {
          exists: existsSync,
          openPath: vi.fn(),
          showItemInFolder: vi.fn(),
        },
      });

    await expect(createService().stopRecording("recording-1")).resolves.toEqual({
      success: false,
      error: "journal disk full",
    });

    expect(journal.session).toMatchObject({
      id: "recording-1",
      status: "finalizing",
      sections: [{ path: sectionPath }],
      recoveryExhaustion: {
        state: "pending-probe",
        outputPath,
        artifactIdentity: ownedIdentity,
      },
    });
    expect(existsSync(outputPath)).toBe(true);
    expect(existsSync(sectionPath)).toBe(true);
    expect(cleanupSections).not.toHaveBeenCalled();
    expect(cleanupFailedArtifact).not.toHaveBeenCalled();

    const restarted = createService();
    await expect(restarted.stopRecording("recording-1")).resolves.toEqual({ success: true });
    expect(finalize).not.toHaveBeenCalled();
    expect(journal).toEqual({ version: 2, state: "empty", session: null });
    expect(restarted.getSnapshot().notice).toMatchObject({
      outcome: "partial",
      outputPath,
      artifactIdentity: ownedIdentity,
    });
    expect(cleanupSections).toHaveBeenCalledWith([sectionPath]);
    expect(cleanupFailedArtifact).not.toHaveBeenCalled();
  });

  it.each([
    "throws",
    "returns false",
  ] as const)("releases the same-service retry lock when Partial settlement %s", async (settlementFailure) => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-partial-stale-settle-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "recording.mp4");
    writeFileSync(outputPath, "verified-partial");
    const store = createStore({
      version: 1,
      session: exhaustionCrashSession(directory, {
        state: "pending-probe",
        error: "stream access removed",
        outputPath,
        outputFormat: "mp4",
        usedFallback: false,
        artifactIdentity: ownedIdentity,
      }),
    });
    const cleanupSections = vi.fn(async () => undefined);
    const cleanupFailedArtifact = vi.fn(async () => undefined);
    const resolvePlayback = vi.fn();
    const startRecorder = vi.fn();
    const finalize = vi.fn();
    let settlementAttempts = 0;
    const service = createStreamRecordingService({
      sessionStore: store,
      resolvePlayback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
      sectionFinalizer: { finalize },
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
      cleanupSections,
      cleanupFailedArtifact,
      recordingFileActions: {
        exists: existsSync,
        openPath: vi.fn(),
        showItemInFolder: vi.fn(),
      },
      outcomeCoordinator: {
        settle: vi.fn((sessionId, notice) => {
          settlementAttempts += 1;
          if (settlementAttempts === 1) {
            if (settlementFailure === "throws") throw new Error("journal disk full");
            return false;
          }
          return store.settle(sessionId, notice);
        }),
        getCurrentNotice: vi.fn(() => null),
        open: vi.fn(async () => ({ success: false })),
        show: vi.fn(async () => ({ success: false })),
        dismiss: vi.fn(() => false),
      },
    });

    await expect(service.stopRecording("recording-1")).resolves.toEqual({
      success: false,
      error:
        settlementFailure === "throws"
          ? "journal disk full"
          : "Recording session changed before partial outcome delivery",
    });
    expect(store.getJournal().session).toMatchObject({
      id: "recording-1",
      recoveryExhaustion: { state: "pending-probe", outputPath },
    });
    expect(cleanupSections).not.toHaveBeenCalled();
    expect(cleanupFailedArtifact).not.toHaveBeenCalled();

    await expect(service.stopRecording("recording-1")).resolves.toEqual({ success: true });
    expect(settlementAttempts).toBe(2);
    expect(store.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(cleanupSections).toHaveBeenCalledWith([
      ownedSectionPath(path.join(directory, "recording.mp4"), 1, "recording-1"),
    ]);
    expect(cleanupFailedArtifact).not.toHaveBeenCalled();
    expect(resolvePlayback).not.toHaveBeenCalled();
    expect(startRecorder).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it("routes recorder completion through the pending probe instead of the Completed finalizer", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-finalize-guard-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "recording.mp4");
    writeFileSync(outputPath, "playable-partial");
    let resolveDone: (value: { outputPath: string; format: "ts"; partial: boolean }) => void =
      () => {};
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      resolveDone = resolve;
    });
    const store = createStore();
    const finalize = vi.fn();
    const probeArtifact = vi.fn(async () => true);
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "master",
        format: "hls",
        streamId: "stream-live-123",
      })),
      resolveQualityCatalog: vi.fn(async () => [source]),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => outputPath),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => ({ stop: vi.fn(), done })),
      sectionFinalizer: { finalize },
      probeArtifact,
      verifyArtifactIdentity: vi.fn(async () => true),
      cleanupSections: vi.fn(async () => undefined),
      recordingFileActions: {
        exists: existsSync,
        openPath: vi.fn(async () => ""),
        showItemInFolder: vi.fn(),
      },
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    const active = store.getJournal().session!;
    store.saveSession({
      ...active,
      partial: true,
      committedOutputPath: outputPath,
      committedArtifactIdentity: ownedIdentity,
      outputFormat: "mp4",
      usedFallback: false,
      recoveryExhaustion: {
        state: "pending-probe",
        error: "reconnect deadline exhausted",
        outputPath,
        outputFormat: "mp4",
        usedFallback: false,
        artifactIdentity: ownedIdentity,
      },
    });

    resolveDone({ outputPath: active.sections[0].path, format: "ts", partial: true });
    await vi.waitFor(() => expect(service.getSnapshot().active).toBeNull());

    expect(finalize).not.toHaveBeenCalled();
    expect(probeArtifact).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().notice).toMatchObject({ outcome: "partial", outputPath });
    expect(service.getSnapshot().notice?.outcome).not.toBe("completed");
  });

  it("aborts a hanging stale resolver when Pause wins, then only Resume may restart", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const first = deferredRecorder();
    const second = deferredRecorder();
    let resolveStale: (value: { url: string; format: string; streamId: string }) => void = () => {};
    const staleResolution = new Promise<{ url: string; format: string; streamId: string }>(
      (resolve) => {
        resolveStale = resolve;
      }
    );
    let staleSignal: AbortSignal | undefined;
    const resolvePlayback = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://cdn.example/master.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })
      .mockImplementationOnce((_request, signal) => {
        staleSignal = signal;
        return staleResolution;
      })
      .mockResolvedValue({
        url: "https://cdn.example/master.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      });
    const startRecorder = vi
      .fn()
      .mockReturnValueOnce(first.recorder)
      .mockReturnValue(second.recorder);
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback,
      resolveQualityCatalog: vi.fn(async () => [source]),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:/Videos/recording.mp4"),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
      monotonicNow: () => Date.now(),
      reconnectBackoffMs: [1000],
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    first.reject(new Error("socket lost"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(staleSignal?.aborted).toBe(false);

    await expect(service.pauseRecording("recording-1")).resolves.toEqual({ success: true });
    expect(staleSignal?.aborted).toBe(true);
    expect(service.getSnapshot().active?.status).toBe("paused");
    await expect(service.resumeRecording("recording-1")).resolves.toEqual({ success: true });
    expect(startRecorder).toHaveBeenCalledTimes(2);

    resolveStale({
      url: "https://stale.example/master.m3u8",
      format: "hls",
      streamId: "stream-live-123",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(startRecorder).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().active?.status).toBe("recording");
  });

  it("aborts a hanging resolver when Stop wins and never starts a stale section", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const first = deferredRecorder();
    let staleSignal: AbortSignal | undefined;
    const resolvePlayback = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://cdn.example/master.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })
      .mockImplementation((_request, signal) => {
        staleSignal = signal;
        return new Promise(() => {});
      });
    const startRecorder = vi.fn(() => first.recorder);
    const finalize = vi.fn(async () => ({
      outputPath: "D:/Videos/recording.mp4",
      format: "mp4" as const,
      usedFallback: false,
      ownedSectionPaths: [ownedSectionPath("D:/Videos/recording.mp4", 1, "recording-1")],
      artifactIdentity: ownedIdentity,
    }));
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback,
      resolveQualityCatalog: vi.fn(async () => [source]),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => "D:/Videos/recording.mp4"),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
      sectionFinalizer: { finalize },
      cleanupSections: vi.fn(async () => undefined),
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
      monotonicNow: () => Date.now(),
      reconnectBackoffMs: [1000],
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    first.reject(new Error("socket lost"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(staleSignal?.aborted).toBe(false);

    await expect(service.stopRecording("recording-1")).resolves.toEqual({ success: true });

    expect(staleSignal?.aborted).toBe(true);
    expect(startRecorder).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [
          expect.objectContaining({
            path: ownedSectionPath("D:/Videos/recording.mp4", 1, "recording-1"),
          }),
        ],
      })
    );
    expect(service.getSnapshot().notice?.outcome).toBe("completed");
  });

  it("emits Failed with no path and preserves staging bytes when output is not playable", async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-failed-recovery-"));
    temporaryDirectories.push(directory);
    const outputPath = path.join(directory, "unplayable.mp4");
    const sectionPath = ownedSectionPath(outputPath, 1, "recording-1");
    const store = createStore();
    const first = deferredRecorder();
    const service = createStreamRecordingService({
      sessionStore: store,
      createId: () => "recording-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi
        .fn()
        .mockResolvedValueOnce({ url: "master", format: "hls", streamId: "stream-live-123" })
        .mockRejectedValue(new Error("offline")),
      resolveQualityCatalog: vi.fn(async () => [source]),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => path.join(directory, "recording.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => {
        writeFileSync(sectionPath, "preserve-me", { flag: "wx" });
        return first.recorder;
      }),
      sectionFinalizer: {
        finalize: vi.fn(async ({ beforeCommit }) => {
          await beforeCommit?.({
            outputPath,
            format: "mp4",
            usedFallback: false,
            artifactIdentity: ownedIdentity,
          });
          writeFileSync(outputPath, "not-media", { flag: "wx" });
          return {
            outputPath,
            format: "mp4" as const,
            usedFallback: false,
            ownedSectionPaths: [sectionPath],
            artifactIdentity: ownedIdentity,
          };
        }),
      },
      probeArtifact: vi.fn(async () => false),
      verifyArtifactIdentity: vi.fn(async () => true),
      monotonicNow: () => Date.now(),
      reconnectBackoffMs: [1000],
      reconnectWindowMs: 1000,
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Live" });
    first.reject(new Error("socket lost"));
    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(service.getSnapshot().active).toBeNull());

    expect(readFileSync(sectionPath, "utf8")).toBe("preserve-me");
    expect(existsSync(outputPath)).toBe(false);
    expect(service.getSnapshot().notice).toMatchObject({ outcome: "failed" });
    expect(service.getSnapshot().notice).not.toHaveProperty("outputPath");
  });
});
