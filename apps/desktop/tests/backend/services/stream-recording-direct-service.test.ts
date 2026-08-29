import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamRecordingOutcomeCoordinator } from "@backend/services/stream-recording-outcome-coordinator";
import { createOwnedRecordingSectionPath } from "@backend/services/stream-recording-paths";
import { createStreamRecordingService } from "@backend/services/stream-recording-service";
import { createStreamRecordingSessionStore } from "@backend/services/stream-recording-session-store";
import type { StreamRecordingJournal } from "@shared/stream-recording-types";
import { testVideoPath } from "./stream-recording-test-paths";

type StartRecorderInput = Parameters<
  Parameters<typeof createStreamRecordingService>[0]["startRecorder"]
>[0];

const artifactIdentity = {
  algorithm: "sha256" as const,
  digest: "test-artifact",
  size: 1,
};

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createSessionStore(seed: StreamRecordingJournal = { version: 1, session: null }) {
  let journal = seed;
  return createStreamRecordingSessionStore({
    storage: {
      getStreamRecordingJournal: () => journal,
      saveStreamRecordingJournal: (next) => {
        journal = next;
      },
    },
  });
}

function ownedSectionPath(destinationPath: string, sectionNumber: number, sessionId: string) {
  return createOwnedRecordingSectionPath(destinationPath, sessionId, sectionNumber);
}

function pendingRecorder() {
  return {
    stop: vi.fn(async () => ({
      outputPath: testVideoPath("stream.mp4"),
      format: "mp4" as const,
      partial: false,
    })),
    done: new Promise<{ outputPath: string; format: "mp4"; partial: boolean }>(() => {}),
  };
}

// Guards: only one direct-to-file recording may reserve or own the recorder at a time
// Guards: cancelled quality and save choices leave no session behind and allow a later recording
// Guards: recorder progress and terminal outcomes update recording state without entering Downloads
// Guards: a failed progress journal write stops capture without escaping the recorder callback or losing TS evidence
// Guards: paused Resume verifies the same Stream before mutation, and output commit intent is durable before commit.
// Guards: a route-provided stable Stream identity starts recording when a platform playback resolver omits identity metadata.
describe("direct-to-file Stream Recording service", () => {
  it("stops capture, deletes only the active session's owned sections, and clears without a notice", async () => {
    const sessionStore = createSessionStore();
    const recorder = pendingRecorder();
    const discardArtifacts = vi.fn(async () => undefined);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
      discardArtifacts,
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    await expect(service.discardRecording("recording-session-1")).resolves.toEqual({
      success: true,
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(discardArtifacts).toHaveBeenCalledWith([
      ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
    ]);
    expect(sessionStore.getJournal().session).toBeNull();
    expect(service.getSnapshot()).toEqual({ active: null, notice: null });
  });

  it("deletes a current-session output only after its recorded identity is verified", async () => {
    const sessionStore = createSessionStore();
    const discardArtifacts = vi.fn(async () => undefined);
    const verifyArtifactIdentity = vi.fn(async () => true);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => pendingRecorder()),
      discardArtifacts,
      verifyArtifactIdentity,
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    const active = sessionStore.getJournal().session!;
    sessionStore.saveSession({
      ...active,
      outputFormat: "mp4",
      committedOutputPath: testVideoPath("stream.mp4"),
      committedArtifactIdentity: artifactIdentity,
      usedFallback: false,
    });

    await expect(service.discardRecording("recording-session-1")).resolves.toEqual({
      success: true,
    });

    expect(verifyArtifactIdentity).toHaveBeenCalledWith(
      testVideoPath("stream.mp4"),
      artifactIdentity
    );
    expect(discardArtifacts).toHaveBeenCalledWith([
      ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
      testVideoPath("stream.mp4"),
    ]);
  });

  it("preserves the session and every artifact when recorder shutdown fails", async () => {
    const sessionStore = createSessionStore();
    const recorder = pendingRecorder();
    recorder.stop.mockRejectedValueOnce(new Error("recorder still owns the file"));
    const discardArtifacts = vi.fn(async () => undefined);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
      discardArtifacts,
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    await expect(service.discardRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "recorder still owns the file",
    });

    expect(discardArtifacts).not.toHaveBeenCalled();
    expect(sessionStore.getJournal().session).toMatchObject({
      id: "recording-session-1",
      status: "recording",
    });
    expect(service.getSnapshot().notice).toBeNull();
  });

  it("writes the first and resumed captures to distinct section paths and keeps cumulative time", async () => {
    const sessionStore = createSessionStore();
    const recorders = [pendingRecorder(), pendingRecorder(), pendingRecorder()];
    const recorderInputs: StartRecorderInput[] = [];
    const startRecorder = vi.fn((input: StartRecorderInput) => {
      recorderInputs.push(input);
      return recorders.shift()!;
    });
    const sectionPath = vi.fn(ownedSectionPath);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: sectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    const firstProgress = recorderInputs[0]!.onProgress;
    firstProgress({ elapsedSeconds: 8 });
    await service.pauseRecording("recording-session-1");
    await service.resumeRecording("recording-session-1");
    const secondProgress = recorderInputs[1]!.onProgress;
    secondProgress({ elapsedSeconds: 3 });
    await service.pauseRecording("recording-session-1");
    await service.resumeRecording("recording-session-1");
    const thirdProgress = recorderInputs[2]!.onProgress;
    thirdProgress({ elapsedSeconds: 2 });

    expect(recorderInputs.map((input) => input.destinationPath)).toEqual([
      testVideoPath("stream.streamfusion-recording-session-1-part-001.ts"),
      testVideoPath("stream.streamfusion-recording-session-1-part-002.ts"),
      testVideoPath("stream.streamfusion-recording-session-1-part-003.ts"),
    ]);
    expect(sessionStore.getJournal().session).toMatchObject({
      streamId: "stream-live-123",
      status: "recording",
      capturedDurationSeconds: 13,
      sections: [
        {
          id: "recording-session-1-part-1",
          path: ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
        },
        {
          id: "recording-session-1-part-2",
          path: ownedSectionPath(testVideoPath("stream.mp4"), 2, "recording-session-1"),
        },
        {
          id: "recording-session-1-part-3",
          path: ownedSectionPath(testVideoPath("stream.mp4"), 3, "recording-session-1"),
        },
      ],
    });
  });

  it("refuses to start without an authoritative Stream identity", async () => {
    const sessionStore = createSessionStore();
    const chooseSavePath = vi.fn(async () => testVideoPath("stream.mp4"));
    const startRecorder = vi.fn(() => pendingRecorder());
    const service = createStreamRecordingService({
      sessionStore,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath,
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });

    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" })
    ).resolves.toEqual({
      success: false,
      outcome: "failed",
      error: "Stable Stream identity is unavailable",
    });

    expect(chooseSavePath).not.toHaveBeenCalled();
    expect(startRecorder).not.toHaveBeenCalled();
    expect(sessionStore.getJournal().session).toBeNull();
  });

  it("uses the route-provided stable identity when playback resolution omits it", async () => {
    const sessionStore = createSessionStore();
    const startRecorder = vi.fn(() => pendingRecorder());
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });

    await expect(
      service.startRecording({
        platform: "kick",
        channelName: "nerdballertv",
        streamId: "kick-live-987",
        title: "NerdBallerTV Live",
      })
    ).resolves.toEqual({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    });

    expect(startRecorder).toHaveBeenCalledTimes(1);
    expect(sessionStore.getJournal().session).toMatchObject({
      streamId: "kick-live-987",
      platform: "kick",
      channelName: "nerdballertv",
    });
  });

  it("resumes a paused recording with its stable session identity when playback omits identity metadata", async () => {
    const sessionStore = createSessionStore();
    const recorders = [pendingRecorder(), pendingRecorder()];
    const startRecorder = vi.fn(() => recorders.shift()!);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });

    await service.startRecording({
      platform: "kick",
      channelName: "nicklee",
      streamId: "kick-live-987",
      title: "NickLee Live",
    });
    await service.pauseRecording("recording-session-1");

    await expect(service.resumeRecording("recording-session-1")).resolves.toEqual({
      success: true,
    });
    expect(startRecorder).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot().active).toMatchObject({
      sessionId: "recording-session-1",
      status: "recording",
      capturedDurationSeconds: 0,
    });
  });

  it("freezes progress while paused and exposes only the current session gap summary", async () => {
    const sessionStore = createSessionStore();
    const recorders = [pendingRecorder(), pendingRecorder()];
    const recorderInputs: StartRecorderInput[] = [];
    const startRecorder = vi.fn((input: StartRecorderInput) => {
      recorderInputs.push(input);
      return recorders.shift()!;
    });
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    const lateFirstProgress = recorderInputs[0]!.onProgress;
    lateFirstProgress({ elapsedSeconds: 9 });
    await service.pauseRecording("recording-session-1");
    lateFirstProgress({ elapsedSeconds: 99 });

    expect(service.getSnapshot().active).toMatchObject({
      status: "paused",
      capturedDurationSeconds: 9,
      gapCount: 1,
      hasOpenGap: true,
    });

    await service.resumeRecording("recording-session-1");
    expect(service.getSnapshot().active).toMatchObject({
      status: "recording",
      capturedDurationSeconds: 9,
      gapCount: 1,
      hasOpenGap: false,
    });
  });

  it("keeps the paused journal truthful when a resumed recorder cannot spawn", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    const persistedDuringResume: StreamRecordingJournal[] = [];
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          journal = structuredClone(next);
          persistedDuringResume.push(journal);
        },
      },
    });
    const startRecorder = vi
      .fn()
      .mockImplementationOnce(() => pendingRecorder())
      .mockImplementationOnce(() => {
        throw new Error("ffmpeg spawn failed");
      });
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    await service.pauseRecording("recording-session-1");
    const paused = sessionStore.getJournal().session;
    persistedDuringResume.length = 0;

    await expect(service.resumeRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "ffmpeg spawn failed",
    });

    expect(sessionStore.getJournal().session).toMatchObject({
      status: "paused",
      sections: paused?.sections,
      gaps: paused?.gaps,
    });
    expect(service.getSnapshot().active).toMatchObject({ hasOpenGap: true, gapCount: 1 });
    expect(
      persistedDuringResume.map((entry) => ({
        status: entry.session?.status,
        sectionCount: entry.session?.sections.length,
        hasOpenGap: entry.session?.gaps.some((gap) => !gap.endedAt),
      }))
    ).toEqual([
      { status: "preparing", sectionCount: 2, hasOpenGap: false },
      { status: "paused", sectionCount: 1, hasOpenGap: true },
    ]);
    expect(persistedDuringResume.some((entry) => entry.session?.status === "recording")).toBe(
      false
    );
  });

  it("refuses to splice a paused recording into a different Stream before any new mutation", async () => {
    const sessionStore = createSessionStore();
    const first = pendingRecorder();
    const startRecorder = vi.fn(() => first);
    const resolvePlayback = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })
      .mockResolvedValueOnce({
        url: "https://cdn.example/new-live.m3u8",
        format: "hls",
        streamId: "stream-live-456",
      });
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    await service.pauseRecording("recording-session-1");
    const before = structuredClone(sessionStore.getJournal());

    await expect(service.resumeRecording("recording-session-1")).resolves.toEqual({
      success: false,
      code: "stream-changed",
      error: "This Channel is now showing a different Stream",
    });

    expect(resolvePlayback).toHaveBeenLastCalledWith(
      expect.objectContaining({ streamId: "stream-live-123" }),
      undefined,
      { forceRefresh: true }
    );
    expect(startRecorder).toHaveBeenCalledTimes(1);
    expect(sessionStore.getJournal()).toEqual(before);
  });

  it("stops a resumed recorder before restoring Paused when Recording status cannot persist", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failResumedRecordingSave = true;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (
            next.session?.status === "recording" &&
            next.session.sections.length === 2 &&
            failResumedRecordingSave
          ) {
            failResumedRecordingSave = false;
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    let finishResumedRecorder: (result: {
      outputPath: string;
      format: "ts";
      partial: boolean;
    }) => void = () => undefined;
    const resumedDone = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>(
      (resolve) => {
        finishResumedRecorder = resolve;
      }
    );
    const resumedPath = ownedSectionPath(testVideoPath("stream.mp4"), 2, "recording-session-1");
    const resumedStop = vi.fn(() => resumedDone);
    const startRecorder = vi
      .fn()
      .mockImplementationOnce(() => pendingRecorder())
      .mockImplementationOnce(() => ({ stop: resumedStop, done: resumedDone }));
    const cleanupAbortedSection = vi.fn(async () => undefined);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
      cleanupAbortedSection,
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    await service.pauseRecording("recording-session-1");
    const paused = structuredClone(sessionStore.getJournal().session);
    let settled = false;

    const resuming = service.resumeRecording("recording-session-1").finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(resumedStop).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);

    finishResumedRecorder({ outputPath: resumedPath, format: "ts", partial: true });
    await expect(resuming).resolves.toEqual({ success: false, error: "journal disk full" });
    expect(sessionStore.getJournal().session).toMatchObject({
      status: "paused",
      sections: paused?.sections,
      gaps: paused?.gaps,
      capturedDurationSeconds: paused?.capturedDurationSeconds,
      qualityLabel: paused?.qualityLabel,
    });
    expect(sessionStore.getJournal().session?.sections).toHaveLength(1);
    expect(cleanupAbortedSection).toHaveBeenCalledWith(resumedPath);
  });

  it("preserves sentinel bytes from every earlier capture section", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-recording-"));
    temporaryDirectories.push(directory);
    const destination = path.join(directory, "stream.mp4");
    let captureNumber = 0;
    const service = createStreamRecordingService({
      sessionStore: createSessionStore(),
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => destination),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: ({ destinationPath }) => {
        captureNumber += 1;
        writeFileSync(destinationPath, `sentinel-${captureNumber}`, { flag: "wx" });
        return {
          stop: vi.fn(async () => ({
            outputPath: destinationPath,
            format: "mp4" as const,
            partial: false,
          })),
          done: new Promise<never>(() => {}),
        };
      },
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    await service.pauseRecording("recording-session-1");
    await service.resumeRecording("recording-session-1");

    expect(readFileSync(ownedSectionPath(destination, 1, "recording-session-1"), "utf8")).toBe(
      "sentinel-1"
    );
    expect(readFileSync(ownedSectionPath(destination, 2, "recording-session-1"), "utf8")).toBe(
      "sentinel-2"
    );
  });

  it("serializes pause and resume transitions for a session", async () => {
    let releaseStop: () => void = () => {};
    const stopPending = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const recorder = pendingRecorder();
    recorder.stop.mockImplementation(async () => {
      await stopPending;
      return { outputPath: testVideoPath("section-1.mp4"), format: "mp4", partial: false };
    });
    const service = createStreamRecordingService({
      sessionStore: createSessionStore(),
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    const firstPause = service.pauseRecording("recording-session-1");
    await expect(service.pauseRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "Recording is busy",
    });
    await expect(service.resumeRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "Recording is busy",
    });
    await expect(service.stopRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "Recording is busy",
    });
    releaseStop();
    await expect(firstPause).resolves.toEqual({ success: true });
  });

  it("publishes Paused while the recorder exits and retains the session after exit resolves", async () => {
    let resolveDone: (result: {
      outputPath: string;
      format: "mp4";
      partial: boolean;
    }) => void = () => {};
    const done = new Promise<{ outputPath: string; format: "mp4"; partial: boolean }>(
      (resolve) => {
        resolveDone = resolve;
      }
    );
    const recorder = {
      done,
      stop: vi.fn(() => done),
    };
    const finalize = vi.fn();
    const service = createStreamRecordingService({
      sessionStore: createSessionStore(),
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
      sectionFinalizer: { finalize },
    });
    await service.startRecording({ platform: "kick", channelName: "nicklee", title: "Live" });

    const pause = service.pauseRecording("recording-session-1");

    expect(service.getSnapshot().active).toMatchObject({
      sessionId: "recording-session-1",
      status: "paused",
      statusMessage: "Pausing",
    });

    resolveDone({ outputPath: testVideoPath("stream.mp4"), format: "mp4", partial: true });
    await expect(pause).resolves.toEqual({ success: true });
    await Promise.resolve();

    expect(service.getSnapshot()).toMatchObject({
      active: {
        sessionId: "recording-session-1",
        status: "paused",
        statusMessage: null,
      },
      notice: null,
    });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("marks the journal Interrupted when a graceful Pause cannot finalize its section", async () => {
    const recorder = pendingRecorder();
    recorder.stop.mockRejectedValue(
      new Error("ffmpeg was forced to stop before finalizing the recording section")
    );
    const sessionStore = createSessionStore();
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    await expect(service.pauseRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "ffmpeg was forced to stop before finalizing the recording section",
    });

    expect(sessionStore.getJournal().session).toMatchObject({
      status: "interrupted",
      partial: true,
      sections: [{ path: ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1") }],
    });
  });

  it("keeps capture live when the Pausing state cannot be persisted", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let rejectPauseRecoveryWrites = false;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (
            rejectPauseRecoveryWrites &&
            (next.session?.status === "paused" || next.session?.status === "interrupted")
          ) {
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    const recorder = pendingRecorder();
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    const before = structuredClone(sessionStore.getJournal());
    rejectPauseRecoveryWrites = true;

    await expect(service.pauseRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "journal disk full",
    });

    expect(recorder.stop).not.toHaveBeenCalled();
    expect(sessionStore.getJournal()).toEqual(before);
    await expect(service.pauseRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "journal disk full",
    });
  });

  it("persists Finalizing before stopping capture and completes only after section assembly", async () => {
    let releaseStop: () => void = () => {};
    const stopPending = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const recorder = pendingRecorder();
    recorder.stop.mockImplementation(async () => {
      await stopPending;
      return { outputPath: testVideoPath("section-1.mp4"), format: "mp4", partial: true };
    });
    let releaseFinalizer: () => void = () => {};
    const finalizerPending = new Promise<void>((resolve) => {
      releaseFinalizer = resolve;
    });
    const finalize = vi.fn(async () => {
      await finalizerPending;
      return {
        outputPath: testVideoPath("stream.mp4"),
        format: "mp4" as const,
        usedFallback: false,
        ownedSectionPaths: [
          ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
        ],
        artifactIdentity,
      };
    });
    let releaseProbe: () => void = () => {};
    const probePending = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const probeArtifact = vi.fn(async () => {
      await probePending;
      return true;
    });
    const sessionStore = createSessionStore();
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
      sectionFinalizer: { finalize },
      probeArtifact,
      verifyArtifactIdentity: vi.fn(async () => true),
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    const stopping = service.stopRecording("recording-session-1");
    expect(service.getSnapshot().active?.status).toBe("finalizing");
    await expect(service.pauseRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "Recording is busy",
    });
    await expect(service.stopRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "Recording is busy",
    });

    releaseStop();
    await vi.waitFor(() => expect(finalize).toHaveBeenCalledTimes(1));
    expect(service.getSnapshot().active?.status).toBe("finalizing");
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        ffmpegPath: "ffmpeg",
        destinationPath: path.normalize(testVideoPath("stream.mp4")),
        sections: [
          expect.objectContaining({
            path: ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
            endedAt: expect.any(String),
          }),
        ],
        beforeCommit: expect.any(Function),
      })
    );

    releaseFinalizer();
    await vi.waitFor(() => expect(probeArtifact).toHaveBeenCalledTimes(1));
    expect(service.getSnapshot().active?.status).toBe("finalizing");
    expect(service.getSnapshot().notice).toBeNull();
    releaseProbe();
    await expect(stopping).resolves.toEqual({ success: true });
    expect(sessionStore.getJournal().session).toBeNull();
    expect(service.getSnapshot().notice).toMatchObject({
      outcome: "completed",
      outputPath: testVideoPath("stream.mp4"),
      outputFormat: "mp4",
      usedFallback: false,
    });
  });

  it("stops capture and returns a typed Stop failure when recovery persistence is unavailable", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let rejectStopRecoveryWrites = false;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (
            rejectStopRecoveryWrites &&
            (next.session?.status === "finalizing" || next.session?.status === "interrupted")
          ) {
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    let finishRecorder: (result: {
      outputPath: string;
      format: "ts";
      partial: boolean;
    }) => void = () => undefined;
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      finishRecorder = resolve;
    });
    const outputPath = ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1");
    const stop = vi.fn(() => done);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => ({ stop, done })),
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    const before = structuredClone(sessionStore.getJournal());
    rejectStopRecoveryWrites = true;
    let settled = false;

    const stopping = service.stopRecording("recording-session-1").finally(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);

    finishRecorder({ outputPath, format: "ts", partial: true });
    await expect(stopping).resolves.toEqual({ success: false, error: "journal disk full" });
    expect(sessionStore.getJournal()).toEqual(before);
    await expect(service.pauseRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "Recording session not found",
    });
  });

  it("retains committed output and sections until durable journal clear succeeds", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failNextClear = true;
    const events: string[] = [];
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (!next.session && failNextClear) {
            failNextClear = false;
            events.push("clear-failed");
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
          events.push(next.session ? `save-${next.session.status}` : "clear-succeeded");
        },
      },
    });
    const recorder = pendingRecorder();
    const finalize = vi.fn(async () => ({
      outputPath: testVideoPath("stream.mp4"),
      format: "mp4" as const,
      usedFallback: false,
      ownedSectionPaths: [ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1")],
      artifactIdentity,
    }));
    const cleanupSections = vi.fn(async () => {
      events.push("cleanup-sections");
    });
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
      sectionFinalizer: { finalize },
      cleanupSections,
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    await expect(service.stopRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "journal disk full",
    });

    expect(sessionStore.getJournal().session).toMatchObject({
      status: "finalizing",
      committedOutputPath: testVideoPath("stream.mp4"),
      outputFormat: "mp4",
      sections: [{ path: ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1") }],
    });
    expect(cleanupSections).not.toHaveBeenCalled();

    await expect(service.stopRecording("recording-session-1")).resolves.toEqual({ success: true });

    expect(finalize).toHaveBeenCalledTimes(1);
    expect(sessionStore.getJournal().session).toBeNull();
    expect(cleanupSections).toHaveBeenCalledWith([
      ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
    ]);
    expect(events.indexOf("clear-succeeded")).toBeLessThan(events.indexOf("cleanup-sections"));
  });

  it("persists a normal-finalization commit intent before the output can be atomically committed", async () => {
    const sessionStore = createSessionStore();
    const recorder = pendingRecorder();
    const finalize = vi.fn(async ({ beforeCommit }) => {
      await beforeCommit?.({
        outputPath: testVideoPath("stream.mp4"),
        format: "mp4" as const,
        usedFallback: false,
        artifactIdentity,
      });
      throw new Error("simulated crash after commit intent");
    });
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
      sectionFinalizer: { finalize },
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    await expect(service.stopRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "simulated crash after commit intent",
    });

    expect(sessionStore.getJournal().session).toMatchObject({
      status: "interrupted",
      recoveryExhaustion: {
        state: "commit-intent",
        outputPath: testVideoPath("stream.mp4"),
        artifactIdentity,
      },
    });
    expect(service.getSnapshot().active).toMatchObject({ recoveryFinalizeOnly: true });
  });

  it("settles a detected committed output after service restart without assembling twice", async () => {
    const sessionStore = createSessionStore({
      version: 1,
      session: {
        id: "recording-session-1",
        platform: "twitch",
        channelName: "ninja",
        title: "Stream",
        status: "interrupted",
        destinationPath: testVideoPath("stream.mp4"),
        committedOutputPath: testVideoPath("stream.mp4"),
        committedArtifactIdentity: artifactIdentity,
        outputFormat: "mp4",
        usedFallback: false,
        qualityLabel: "source",
        capturedDurationSeconds: 10,
        sections: [
          {
            id: "recording-session-1-part-1",
            path: ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
            startedAt: "2026-07-11T12:00:00.000Z",
            endedAt: "2026-07-11T12:00:10.000Z",
          },
        ],
        gaps: [],
        createdAt: "2026-07-11T12:00:00.000Z",
        updatedAt: "2026-07-11T12:00:10.000Z",
      },
    });
    const finalize = vi.fn();
    const cleanupSections = vi.fn(async () => undefined);
    const service = createStreamRecordingService({
      sessionStore,
      resolvePlayback: vi.fn(),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(),
      sectionFinalizer: { finalize },
      cleanupSections,
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
      recordingFileActions: {
        exists: (candidate) => candidate === testVideoPath("stream.mp4"),
        openPath: vi.fn(),
        showItemInFolder: vi.fn(),
      },
    });

    await expect(service.stopRecording("recording-session-1")).resolves.toEqual({ success: true });

    expect(finalize).not.toHaveBeenCalled();
    expect(sessionStore.getJournal().session).toBeNull();
    expect(cleanupSections).toHaveBeenCalledWith([
      ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
    ]);
    expect(service.getSnapshot().notice).toMatchObject({
      outcome: "completed",
      outputPath: testVideoPath("stream.mp4"),
    });
  });

  it("finalizes closed sections while paused and preserves recovery evidence on assembly failure", async () => {
    const sessionStore = createSessionStore();
    const recorder = pendingRecorder();
    const finalize = vi.fn().mockRejectedValue(new Error("both output formats failed"));
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
      sectionFinalizer: { finalize },
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    await service.pauseRecording("recording-session-1");
    const preservedSections = structuredClone(sessionStore.getJournal().session?.sections);

    await expect(service.stopRecording("recording-session-1")).resolves.toEqual({
      success: false,
      error: "both output formats failed",
    });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        ffmpegPath: "ffmpeg",
        destinationPath: path.normalize(testVideoPath("stream.mp4")),
        sections: preservedSections,
        beforeCommit: expect.any(Function),
      })
    );
    expect(sessionStore.getJournal().session).toMatchObject({
      status: "interrupted",
      statusMessage: "both output formats failed",
      sections: preservedSections,
    });
    expect(sessionStore.getSnapshot().notice).toBeNull();
  });

  it("aborts reconnect retries before finalizing a stopped reconnecting session", async () => {
    let rejectCapture: (error: Error) => void = () => {};
    const done = new Promise<never>((_resolve, reject) => {
      rejectCapture = reject;
    });
    let releaseSleep: () => void = () => {};
    const sleeping = new Promise<void>((resolve) => {
      releaseSleep = resolve;
    });
    const sessionStore = createSessionStore();
    const resolvePlayback = vi.fn(async () => ({
      url: "https://cdn.example/live.m3u8",
      format: "hls",
      streamId: "stream-live-123",
    }));
    const startRecorder = vi.fn(() => ({
      stop: vi.fn(async () => ({
        outputPath: testVideoPath("section-1.mp4"),
        format: "mp4" as const,
        partial: true,
      })),
      done,
    }));
    const finalize = vi.fn(async () => ({
      outputPath: testVideoPath("stream.mp4"),
      format: "mp4" as const,
      usedFallback: false,
      ownedSectionPaths: [ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1")],
      artifactIdentity,
    }));
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
      sectionFinalizer: { finalize },
      sleep: vi.fn(() => sleeping),
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
      reconnectBackoffMs: [1000],
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    rejectCapture(new Error("network disconnected"));
    await vi.waitFor(() => expect(service.getSnapshot().active?.status).toBe("reconnecting"));
    await expect(service.stopRecording("recording-session-1")).resolves.toEqual({ success: true });
    releaseSleep();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolvePlayback).toHaveBeenCalledTimes(1);
    expect(startRecorder).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        sections: [expect.objectContaining({ endedAt: expect.any(String) })],
      })
    );
    expect(sessionStore.getJournal().session).toBeNull();
    expect(service.getSnapshot().notice?.outcome).toBe("completed");
  });

  it("returns a typed Pause failure and keeps recovery live when Reconnecting state cannot persist Paused", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (next.session?.status === "paused") throw new Error("journal disk full");
          journal = structuredClone(next);
        },
      },
    });
    let rejectCapture: (error: Error) => void = () => undefined;
    const firstDone = new Promise<never>((_resolve, reject) => {
      rejectCapture = reject;
    });
    let releaseSleep: () => void = () => undefined;
    const sleeping = new Promise<void>((resolve) => {
      releaseSleep = resolve;
    });
    const resolvePlayback = vi.fn(async () => ({
      url: "https://cdn.example/live.m3u8",
      format: "hls",
      streamId: "stream-live-123",
    }));
    const startRecorder = vi
      .fn()
      .mockImplementationOnce(() => ({ stop: vi.fn(), done: firstDone }))
      .mockImplementationOnce(() => pendingRecorder());
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
      sleep: vi.fn(() => sleeping),
      reconnectBackoffMs: [1000],
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    rejectCapture(new Error("network disconnected"));
    await vi.waitFor(() => expect(service.getSnapshot().active?.status).toBe("reconnecting"));

    const pauseOutcome = await service.pauseRecording("recording-session-1").then(
      (result) => result,
      (error: Error) => ({ success: false, rejected: error.message })
    );
    releaseSleep();
    await vi.waitFor(() => expect(resolvePlayback).toHaveBeenCalledTimes(2));

    expect(pauseOutcome).toEqual({ success: false, error: "journal disk full" });
    expect(sessionStore.getJournal().session).toMatchObject({
      status: "recording",
      sections: [
        expect.objectContaining({
          id: "recording-session-1-part-1",
          endedAt: expect.any(String),
        }),
        expect.objectContaining({ id: "recording-session-1-part-2" }),
      ],
    });
  });

  it("contains a failed reconnect journal write and preserves the ended section", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failReconnectSave = true;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (next.session?.status === "reconnecting" && failReconnectSave) {
            failReconnectSave = false;
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    let rejectCapture: (error: Error) => void = () => undefined;
    const done = new Promise<never>((_resolve, reject) => {
      rejectCapture = reject;
    });
    const stop = vi.fn();
    const startRecorder = vi.fn(() => ({ stop, done }));
    const outputPath = ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1");
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    rejectCapture(new Error("network disconnected"));

    await vi.waitFor(() =>
      expect(sessionStore.getJournal()).toMatchObject({
        state: "interrupted",
        session: {
          status: "interrupted",
          partial: true,
          statusMessage: "journal disk full",
          sections: [expect.objectContaining({ path: outputPath, endedAt: expect.any(String) })],
        },
      })
    );
    expect(startRecorder).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(service.getSnapshot().notice).toBeNull();
  });

  it("stops and rolls back a reconnect recorder when Recording status cannot persist", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failReconnectRecordingSave = true;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (
            next.session?.status === "recording" &&
            next.session.sections.length === 2 &&
            failReconnectRecordingSave
          ) {
            failReconnectRecordingSave = false;
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    let rejectFirstCapture: (error: Error) => void = () => undefined;
    const firstDone = new Promise<never>((_resolve, reject) => {
      rejectFirstCapture = reject;
    });
    let finishSecondCapture: (result: {
      outputPath: string;
      format: "ts";
      partial: boolean;
    }) => void = () => undefined;
    const secondDone = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>(
      (resolve) => {
        finishSecondCapture = resolve;
      }
    );
    const secondPath = ownedSectionPath(testVideoPath("stream.mp4"), 2, "recording-session-1");
    const secondStop = vi.fn(() => {
      const result = { outputPath: secondPath, format: "ts" as const, partial: true };
      finishSecondCapture(result);
      return secondDone;
    });
    const startRecorder = vi
      .fn()
      .mockImplementationOnce(() => ({ stop: vi.fn(), done: firstDone }))
      .mockImplementationOnce(() => ({ stop: secondStop, done: secondDone }));
    const cleanupAbortedSection = vi.fn(async () => undefined);
    const pendingSleep = new Promise<void>(() => undefined);
    const sleep = vi.fn().mockResolvedValueOnce(undefined).mockReturnValue(pendingSleep);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
      cleanupAbortedSection,
      sleep,
      reconnectBackoffMs: [0],
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    rejectFirstCapture(new Error("network disconnected"));

    await vi.waitFor(() => expect(secondStop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(sessionStore.getJournal()).toMatchObject({
        state: "active",
        session: {
          status: "reconnecting",
          sections: [expect.objectContaining({ id: "recording-session-1-part-1" })],
          gaps: [expect.objectContaining({ reason: "reconnect" })],
        },
      })
    );
    expect(sessionStore.getJournal().session?.sections).toHaveLength(1);
    expect(cleanupAbortedSection).toHaveBeenCalledWith(secondPath);
    expect(startRecorder).toHaveBeenCalledTimes(2);
    await expect(service.pauseRecording("recording-session-1")).resolves.toEqual({ success: true });
  });

  it("accepts Stop while Preparing and waits for the recorder before finalizing", async () => {
    const sessionStore = createSessionStore();
    const recorder = pendingRecorder();
    const finalize = vi.fn(async () => ({
      outputPath: testVideoPath("stream.mp4"),
      format: "mp4" as const,
      usedFallback: false,
      ownedSectionPaths: [ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1")],
      artifactIdentity,
    }));
    let stopping: Promise<{ success: boolean; error?: string }> | null = null;
    // eslint-disable-next-line prefer-const -- assigned after subscription so the callback observes creation-time events.
    let service: ReturnType<typeof createStreamRecordingService>;
    sessionStore.subscribe((snapshot) => {
      if (snapshot.active?.status === "preparing" && !stopping) {
        stopping = service.stopRecording("recording-session-1");
      }
    });
    service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
      sectionFinalizer: { finalize },
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
    });

    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" })
    ).resolves.toEqual({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    });
    await expect(stopping).resolves.toEqual({ success: true });

    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().notice?.outcome).toBe("completed");
  });

  it("publishes Preparing then Recording through the standalone session store", async () => {
    const sessionStore = createSessionStore();
    const statuses: string[] = [];
    const recorderInputs: StartRecorderInput[] = [];
    sessionStore.subscribe((snapshot) => {
      if (snapshot.active) statuses.push(snapshot.active.status);
    });
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn((input: StartRecorderInput) => {
        recorderInputs.push(input);
        return pendingRecorder();
      }),
      now: () => "2026-07-11T12:00:00.000Z",
    });

    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" })
    ).resolves.toEqual({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    });
    expect(statuses).toEqual(["preparing", "recording"]);
    expect(recorderInputs[0]?.destinationPath).toBe(
      ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1")
    );
    expect(sessionStore.getJournal().session).toMatchObject({
      id: "recording-session-1",
      status: "recording",
      channelName: "ninja",
    });
  });

  it.each([
    [testVideoPath("stream"), testVideoPath("stream.mp4")],
    [testVideoPath("stream.webm"), testVideoPath("stream.mp4")],
    [testVideoPath("stream.MP4"), testVideoPath("stream.mp4")],
  ])(
    "normalizes the Save destination %s to MP4 before reserving sections",
    async (chosen, expected) => {
      const sessionStore = createSessionStore();
      const recorderInputs: StartRecorderInput[] = [];
      const service = createStreamRecordingService({
        sessionStore,
        createId: () => "recording-session-1",
        resolvePlayback: vi.fn(async () => ({
          url: "https://cdn.example/live.m3u8",
          format: "hls",
          streamId: "stream-live-123",
        })),
        chooseQuality: vi.fn(),
        chooseSavePath: vi.fn(async () => chosen),
        getAvailablePath: (candidate) => candidate,
        resolveFfmpegPath: () => "ffmpeg",
        startRecorder: vi.fn((input: StartRecorderInput) => {
          recorderInputs.push(input);
          return pendingRecorder();
        }),
      });

      await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

      expect(sessionStore.getJournal().session?.destinationPath).toBe(path.normalize(expected));
      expect(recorderInputs[0]?.destinationPath).toBe(
        ownedSectionPath(expected, 1, "recording-session-1")
      );
    }
  );

  it("persists nothing and releases its reservation when Save is cancelled", async () => {
    const sessionStore = createSessionStore();
    const chooseSavePath = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(testVideoPath("stream.mp4"));
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath,
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => pendingRecorder()),
    });

    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "First" })
    ).resolves.toEqual({ success: false, outcome: "cancelled", error: "Save cancelled" });
    expect(sessionStore.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    await expect(
      service.startRecording({ platform: "kick", channelName: "xqc", title: "Second" })
    ).resolves.toEqual({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    });
  });

  it("atomically blocks a simultaneous second start with the reserved Stream identity", async () => {
    const sessionStore = createSessionStore();
    let resolvePlayback: (value: { url: string; format: string; streamId: string }) => void = () =>
      undefined;
    const firstPlayback = new Promise<{ url: string; format: string; streamId: string }>(
      (resolve) => {
        resolvePlayback = resolve;
      }
    );
    const playback = vi.fn(() => firstPlayback);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: playback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => pendingRecorder()),
    });

    const first = service.startRecording({
      platform: "twitch",
      channelName: "ninja",
      title: "First",
    });
    await expect(
      service.startRecording({ platform: "kick", channelName: "xqc", title: "Second" })
    ).resolves.toMatchObject({
      success: false,
      outcome: "blocked",
      code: "stream-recording-active",
      activeRecording: { platform: "twitch", channelName: "ninja", title: "First" },
    });
    expect(playback).toHaveBeenCalledTimes(1);

    resolvePlayback({
      url: "https://cdn.example/live.m3u8",
      format: "hls",
      streamId: "stream-live-123",
    });
    await expect(first).resolves.toEqual({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    });
  });

  it("blocks from a persisted active session without resolving the requested Stream", async () => {
    const sessionStore = createSessionStore({
      version: 1,
      session: {
        id: "recording-session-existing",
        platform: "kick",
        channelName: "active-channel",
        title: "Active Stream",
        status: "recording",
        destinationPath: testVideoPath("active.mp4"),
        qualityLabel: "1080p60",
        capturedDurationSeconds: 12,
        sections: [
          {
            id: "recording-session-existing-part-1",
            path: ownedSectionPath(testVideoPath("active.mp4"), 1, "recording-session-existing"),
            startedAt: "2026-07-11T12:00:00.000Z",
          },
        ],
        gaps: [],
        createdAt: "2026-07-11T12:00:00.000Z",
        updatedAt: "2026-07-11T12:00:12.000Z",
      },
    });
    const playback = vi.fn();
    const service = createStreamRecordingService({
      sessionStore,
      resolvePlayback: playback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(),
    });

    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "Second" })
    ).resolves.toMatchObject({
      success: false,
      outcome: "blocked",
      code: "stream-recording-active",
      activeRecording: {
        sessionId: "recording-session-existing",
        platform: "kick",
        channelName: "active-channel",
        title: "Active Stream",
        status: "interrupted",
      },
    });
    expect(playback).not.toHaveBeenCalled();
  });

  it("clears the Preparing session and reservation when the recorder cannot spawn", async () => {
    const sessionStore = createSessionStore();
    const startRecorder = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("ffmpeg could not start");
      })
      .mockImplementationOnce(() => pendingRecorder());
    const ids = vi
      .fn()
      .mockReturnValueOnce("recording-session-1")
      .mockReturnValueOnce("recording-session-2");
    const service = createStreamRecordingService({
      sessionStore,
      createId: ids,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });

    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "First" })
    ).resolves.toEqual({ success: false, outcome: "failed", error: "ffmpeg could not start" });
    expect(sessionStore.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(service.getSnapshot()).toEqual({ active: null, notice: null });
    await expect(
      service.startRecording({ platform: "kick", channelName: "xqc", title: "Second" })
    ).resolves.toEqual({
      success: true,
      outcome: "started",
      sessionId: "recording-session-2",
    });
  });

  it("returns a typed start failure and releases its reservation when journal storage always fails", async () => {
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => ({ version: 1, session: null }),
        saveStreamRecordingJournal: () => {
          throw new Error("journal unavailable");
        },
      },
    });
    const resolvePlayback = vi.fn(async () => ({
      url: "https://cdn.example/live.m3u8",
      format: "hls",
      streamId: "stream-live-123",
    }));
    const startRecorder = vi.fn(() => pendingRecorder());
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });

    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "First" })
    ).resolves.toEqual({
      success: false,
      outcome: "failed",
      error: "journal unavailable",
    });
    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "Second" })
    ).resolves.toMatchObject({ success: false, outcome: "failed" });

    expect(resolvePlayback).toHaveBeenCalledTimes(2);
    expect(startRecorder).not.toHaveBeenCalled();
    expect(sessionStore.getJournal().session).toBeNull();
  });

  it("dismisses an interrupted recovery session without starting work", async () => {
    const sessionStore = createSessionStore({
      version: 1,
      session: {
        id: "recording-session-interrupted",
        platform: "twitch",
        channelName: "ninja",
        title: "Interrupted Stream",
        status: "interrupted",
        destinationPath: testVideoPath("interrupted.mp4"),
        qualityLabel: "source",
        capturedDurationSeconds: 10,
        sections: [
          {
            id: "recording-session-interrupted-part-1",
            path: ownedSectionPath(
              testVideoPath("interrupted.mp4"),
              1,
              "recording-session-interrupted"
            ),
            startedAt: "2026-07-11T12:00:00.000Z",
          },
        ],
        gaps: [],
        createdAt: "2026-07-11T12:00:00.000Z",
        updatedAt: "2026-07-11T12:00:10.000Z",
      },
    });
    const playback = vi.fn();
    const service = createStreamRecordingService({
      sessionStore,
      resolvePlayback: playback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(),
    });

    await expect(
      service.dismissInterrupted("recording-session-interrupted", true)
    ).resolves.toEqual({ success: true });
    expect(sessionStore.getSnapshot().active).toBeNull();
    expect(playback).not.toHaveBeenCalled();
  });

  it("preserves synchronous recorder progress when transitioning to Recording", async () => {
    const sessionStore = createSessionStore();
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(({ onProgress }) => {
        onProgress({ elapsedSeconds: 5 });
        return pendingRecorder();
      }),
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    expect(sessionStore.getJournal().session).toMatchObject({
      status: "recording",
      capturedDurationSeconds: 5,
    });
  });

  it("awaits recorder shutdown and preserves evidence when synchronous startup progress cannot persist", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failProgressSave = true;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (next.session?.capturedDurationSeconds === 5 && failProgressSave) {
            failProgressSave = false;
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    let finishRecorder: (result: {
      outputPath: string;
      format: "ts";
      partial: boolean;
    }) => void = () => undefined;
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      finishRecorder = resolve;
    });
    const outputPath = ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1");
    const stop = vi.fn(() => done);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(({ onProgress }) => {
        onProgress({ elapsedSeconds: 5 });
        return { stop, done };
      }),
    });
    let settled = false;

    const starting = service
      .startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" })
      .finally(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);

    finishRecorder({ outputPath, format: "ts", partial: true });
    await expect(starting).resolves.toEqual({
      success: false,
      outcome: "failed",
      error: "journal disk full",
    });
    expect(sessionStore.getJournal()).toMatchObject({
      state: "interrupted",
      session: {
        status: "interrupted",
        partial: true,
        capturedDurationSeconds: 0,
        statusMessage: "journal disk full",
        sections: [expect.objectContaining({ path: outputPath, endedAt: expect.any(String) })],
      },
    });
  });

  it("awaits recorder shutdown and preserves evidence when Recording status cannot persist", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failRecordingSave = true;
    const sessionStore = createStreamRecordingSessionStore({
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
    let finishRecorder: (result: {
      outputPath: string;
      format: "ts";
      partial: boolean;
    }) => void = () => undefined;
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      finishRecorder = resolve;
    });
    const outputPath = ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1");
    const stop = vi.fn(() => done);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => ({ stop, done })),
    });
    let settled = false;

    const starting = service
      .startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" })
      .finally(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);

    finishRecorder({ outputPath, format: "ts", partial: true });
    await expect(starting).resolves.toEqual({
      success: false,
      outcome: "failed",
      error: "journal disk full",
    });
    expect(sessionStore.getJournal()).toMatchObject({
      state: "interrupted",
      session: {
        status: "interrupted",
        partial: true,
        statusMessage: "journal disk full",
        sections: [expect.objectContaining({ path: outputPath, endedAt: expect.any(String) })],
      },
    });
  });

  it("stops capture and preserves an Interrupted session when progress persistence fails", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failProgressSave = true;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (
            next.session?.status === "recording" &&
            next.session.capturedDurationSeconds === 5 &&
            failProgressSave
          ) {
            failProgressSave = false;
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    const recorderInputs: StartRecorderInput[] = [];
    let finishRecorder: (result: {
      outputPath: string;
      format: "ts";
      partial: boolean;
    }) => void = () => undefined;
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      finishRecorder = resolve;
    });
    const stoppedResult = {
      outputPath: ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
      format: "ts" as const,
      partial: true,
    };
    const stop = vi.fn(async () => {
      finishRecorder(stoppedResult);
      return stoppedResult;
    });
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn((input) => {
        recorderInputs.push(input);
        return { stop, done };
      }),
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    expect(() => recorderInputs[0]!.onProgress({ elapsedSeconds: 5 })).not.toThrow();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(sessionStore.getJournal()).toMatchObject({
        state: "interrupted",
        session: {
          status: "interrupted",
          partial: true,
          capturedDurationSeconds: 0,
          statusMessage: "journal disk full",
          sections: [
            expect.objectContaining({
              id: "recording-session-1-part-1",
              path: ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
              endedAt: expect.any(String),
            }),
          ],
        },
      })
    );
  });

  it("blocks Finalize and Dismiss while a persistence-failure shutdown owns a live recorder", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failProgressSave = true;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (
            next.session?.status === "recording" &&
            next.session.capturedDurationSeconds === 5 &&
            failProgressSave
          ) {
            failProgressSave = false;
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    const recorderInputs: StartRecorderInput[] = [];
    let finishRecorder: (result: {
      outputPath: string;
      format: "ts";
      partial: boolean;
    }) => void = () => undefined;
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      finishRecorder = resolve;
    });
    const outputPath = ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1");
    const stop = vi.fn(() => done);
    const finalize = vi.fn(async () => ({
      outputPath: testVideoPath("stream.mp4"),
      format: "mp4" as const,
      usedFallback: false,
      ownedSectionPaths: [outputPath],
      artifactIdentity,
    }));
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn((input) => {
        recorderInputs.push(input);
        return { stop, done };
      }),
      sectionFinalizer: { finalize },
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
    });
    let dismissDuringInterruptedPublish: ReturnType<typeof service.dismissInterrupted> | undefined;
    const unsubscribe = sessionStore.subscribe((snapshot) => {
      if (snapshot.active?.status === "interrupted" && !dismissDuringInterruptedPublish) {
        dismissDuringInterruptedPublish = service.dismissInterrupted("recording-session-1", true);
      }
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    recorderInputs[0]!.onProgress({ elapsedSeconds: 5 });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    const finalizeResult = await service.finalizeInterrupted("recording-session-1");
    const dismissResult = await service.dismissInterrupted("recording-session-1", true);
    const publishDismissResult = await dismissDuringInterruptedPublish;
    const finalizedWhileRecorderWasLive = finalize.mock.calls.length > 0;
    finishRecorder({ outputPath, format: "ts", partial: true });

    expect(finalizeResult).toEqual({
      success: false,
      code: "busy",
      error: "Recording is busy",
    });
    expect(dismissResult).toEqual({
      success: false,
      code: "busy",
      error: "Recording is busy",
    });
    expect(publishDismissResult).toEqual({
      success: false,
      code: "busy",
      error: "Recording is busy",
    });
    expect(finalizedWhileRecorderWasLive).toBe(false);
    unsubscribe();
  });

  it("contains a natural-completion journal failure and preserves the finished section", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failFinalizingSave = true;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (next.session?.status === "finalizing" && failFinalizingSave) {
            failFinalizingSave = false;
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    let finishRecorder: (result: {
      outputPath: string;
      format: "ts";
      partial: boolean;
    }) => void = () => undefined;
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      finishRecorder = resolve;
    });
    const outputPath = ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1");
    const stop = vi.fn(() => done);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => ({ stop, done })),
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    finishRecorder({ outputPath, format: "ts", partial: false });

    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(sessionStore.getJournal()).toMatchObject({
        state: "interrupted",
        session: {
          status: "interrupted",
          partial: true,
          statusMessage: "journal disk full",
          sections: [expect.objectContaining({ path: outputPath, endedAt: expect.any(String) })],
        },
      })
    );
    expect(service.getSnapshot().notice).toBeNull();
  });

  it("contains a failed finalization recovery write after natural completion", async () => {
    let journal: StreamRecordingJournal = { version: 1, session: null };
    let failInterruptedSave = true;
    const sessionStore = createStreamRecordingSessionStore({
      storage: {
        getStreamRecordingJournal: () => journal,
        saveStreamRecordingJournal: (next) => {
          if (next.session?.status === "interrupted" && failInterruptedSave) {
            failInterruptedSave = false;
            throw new Error("journal disk full");
          }
          journal = structuredClone(next);
        },
      },
    });
    let finishRecorder: (result: {
      outputPath: string;
      format: "ts";
      partial: boolean;
    }) => void = () => undefined;
    const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>((resolve) => {
      finishRecorder = resolve;
    });
    const outputPath = ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1");
    const stop = vi.fn(() => done);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => ({ stop, done })),
      sectionFinalizer: {
        finalize: vi.fn(async () => {
          throw new Error("both output formats failed");
        }),
      },
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });
    finishRecorder({ outputPath, format: "ts", partial: false });

    await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(sessionStore.getJournal()).toMatchObject({
        state: "interrupted",
        session: {
          status: "interrupted",
          partial: true,
          statusMessage: "both output formats failed",
          sections: [expect.objectContaining({ path: outputPath, endedAt: expect.any(String) })],
        },
      })
    );
    expect(service.getSnapshot().notice).toBeNull();
  });

  it("blocks a sequential second start after the first start succeeds", async () => {
    const sessionStore = createSessionStore();
    const playback = vi.fn(async () => ({
      url: "https://cdn.example/live.m3u8",
      format: "hls",
      streamId: "stream-live-123",
    }));
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: playback,
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => pendingRecorder()),
    });

    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "First" })
    ).resolves.toEqual({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    });
    await expect(
      service.startRecording({ platform: "kick", channelName: "xqc", title: "Second" })
    ).resolves.toMatchObject({
      success: false,
      outcome: "blocked",
      code: "stream-recording-active",
      activeRecording: {
        sessionId: "recording-session-1",
        channelName: "ninja",
        status: "recording",
      },
    });
    expect(playback).toHaveBeenCalledTimes(1);
  });

  it("records the chosen non-first quality URL and label", async () => {
    const sessionStore = createSessionStore();
    const qualities = [
      { quality: "720p", url: "https://cdn.example/720.m3u8" },
      { quality: "1080p60", url: "https://cdn.example/1080.m3u8" },
    ];
    const startRecorder = vi.fn(() => pendingRecorder());
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: vi.fn(async () => ({
        url: qualities[0].url,
        format: "hls",
        streamId: "stream-live-123",
        qualities,
      })),
      chooseQuality: vi.fn(async () => qualities[1]),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });

    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    expect(startRecorder).toHaveBeenCalledWith(
      expect.objectContaining({ inputUrl: "https://cdn.example/1080.m3u8" })
    );
    expect(sessionStore.getJournal().session?.qualityLabel).toBe("1080p60");
  });

  it("uses the quality chosen in the StreamFusion start dialog without opening another picker", async () => {
    const sessionStore = createSessionStore();
    const qualities = [
      { quality: "480p", height: 480, url: "https://cdn.example/480.m3u8" },
      { quality: "720p60", height: 720, fps: 60, url: "https://cdn.example/720.m3u8" },
      { quality: "1080p60", height: 1080, fps: 60, url: "https://cdn.example/1080.m3u8" },
    ];
    const chooseQuality = vi.fn();
    const startRecorder = vi.fn(() => pendingRecorder());
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: vi.fn(async () => ({
        url: qualities[2].url,
        format: "hls",
        streamId: "stream-live-123",
        qualities,
      })),
      chooseQuality,
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder,
    });

    await service.startRecording({
      platform: "twitch",
      channelName: "ninja",
      title: "Stream",
      desiredQuality: { quality: "720p", height: 720 },
    });

    expect(chooseQuality).not.toHaveBeenCalled();
    expect(startRecorder).toHaveBeenCalledWith(
      expect.objectContaining({ inputUrl: "https://cdn.example/720.m3u8" })
    );
    expect(sessionStore.getJournal().session?.qualityLabel).toBe("720p60");
  });

  it("cleans up quality cancellation so a subsequent start can succeed", async () => {
    const sessionStore = createSessionStore();
    const qualities = [
      { quality: "720p", url: "https://cdn.example/720.m3u8" },
      { quality: "1080p60", url: "https://cdn.example/1080.m3u8" },
    ];
    const chooseQuality = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(qualities[1]);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: vi.fn(async () => ({
        url: qualities[0].url,
        format: "hls",
        streamId: "stream-live-123",
        qualities,
      })),
      chooseQuality,
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => pendingRecorder()),
    });

    await expect(
      service.startRecording({ platform: "twitch", channelName: "ninja", title: "First" })
    ).resolves.toEqual({
      success: false,
      outcome: "cancelled",
      error: "Quality selection cancelled",
    });
    expect(sessionStore.getJournal().session).toBeNull();
    await expect(
      service.startRecording({ platform: "kick", channelName: "xqc", title: "Second" })
    ).resolves.toEqual({
      success: true,
      outcome: "started",
      sessionId: "recording-session-1",
    });
  });

  it("clears the persisted session and exposes completion only as a transient notice", async () => {
    const sessionStore = createSessionStore();
    let finish: (result: { outputPath: string; format: "mp4"; partial: boolean }) => void =
      () => {};
    const done = new Promise<{ outputPath: string; format: "mp4"; partial: boolean }>((resolve) => {
      finish = resolve;
    });
    let clearNotice: () => void = () => {};
    const scheduleNoticeClear = vi.fn((callback: () => void) => {
      clearNotice = callback;
    });
    const openPath = vi.fn(async () => "");
    const showItemInFolder = vi.fn();
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-1",
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (path) => path,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => ({ stop: vi.fn(), done })),
      sectionFinalizer: {
        finalize: vi.fn(async () => ({
          outputPath: testVideoPath("stream.mp4"),
          format: "mp4" as const,
          usedFallback: false,
          ownedSectionPaths: [
            ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
          ],
          artifactIdentity,
        })),
      },
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
      scheduleNoticeClear,
      completionNoticeTtlMs: 8000,
      recordingFileActions: {
        exists: vi.fn(() => true),
        openPath,
        showItemInFolder,
      },
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    finish({ outputPath: testVideoPath("stream.mp4"), format: "mp4", partial: false });

    await vi.waitFor(() => expect(service.getSnapshot().active).toBeNull());
    expect(sessionStore.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(service.getSnapshot().notice).toMatchObject({
      sessionId: "recording-session-1",
      outcome: "completed",
      outputPath: testVideoPath("stream.mp4"),
      outputFormat: "mp4",
    });
    expect(scheduleNoticeClear).toHaveBeenCalledWith(expect.any(Function), 8000);
    await expect(service.openCompletedRecording("recording-session-1")).resolves.toEqual({
      success: true,
    });
    await expect(service.showCompletedRecording("recording-session-1")).resolves.toEqual({
      success: true,
    });
    await expect(service.openCompletedRecording("arbitrary-session")).resolves.toEqual({
      success: false,
      error: "Recording outcome not found",
    });
    expect(openPath).toHaveBeenCalledWith(testVideoPath("stream.mp4"));
    expect(showItemInFolder).toHaveBeenCalledWith(testVideoPath("stream.mp4"));

    clearNotice();
    expect(service.getSnapshot()).toEqual({ active: null, notice: null });
  });

  it("reports natural completion as Failed without a path when the owned output is not playable", async () => {
    const sessionStore = createSessionStore();
    let finish: (result: { outputPath: string; format: "mp4"; partial: boolean }) => void =
      () => {};
    const done = new Promise<{ outputPath: string; format: "mp4"; partial: boolean }>((resolve) => {
      finish = resolve;
    });
    const cleanupFailedArtifact = vi.fn(async () => undefined);
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-session-unplayable",
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("unplayable.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => ({ stop: vi.fn(), done })),
      sectionFinalizer: {
        finalize: vi.fn(async () => ({
          outputPath: testVideoPath("unplayable.mp4"),
          format: "mp4" as const,
          usedFallback: false,
          ownedSectionPaths: [
            ownedSectionPath(testVideoPath("unplayable.mp4"), 1, "recording-session-1"),
          ],
          artifactIdentity,
        })),
      },
      probeArtifact: vi.fn(async () => false),
      verifyArtifactIdentity: vi.fn(async () => true),
      cleanupFailedArtifact,
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    finish({ outputPath: testVideoPath("unplayable.mp4"), format: "mp4", partial: false });
    await vi.waitFor(() => expect(service.getSnapshot().notice?.outcome).toBe("failed"));

    const notice = service.getSnapshot().notice;
    expect(notice).toMatchObject({
      sessionId: "recording-session-unplayable",
      outcome: "failed",
      error: "Recording output is not playable",
    });
    expect(notice).not.toHaveProperty("outputPath");
    expect(sessionStore.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(cleanupFailedArtifact).toHaveBeenCalledWith([testVideoPath("unplayable.mp4")]);
  });

  it("finishes cleanup when native outcome presentation throws after durable settlement", async () => {
    const sessionStore = createSessionStore();
    const recorder = pendingRecorder();
    const cleanupSections = vi.fn(async () => undefined);
    const fileActions = {
      exists: vi.fn(() => true),
      openPath: vi.fn(async () => ""),
      showItemInFolder: vi.fn(),
    };
    const outcomeCoordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore,
      getDeliveryContext: () => ({
        visible: false,
        focused: false,
        minimized: true,
        notificationsEnabled: true,
        soundEnabled: true,
        nativeSupported: true,
      }),
      showNative: () => {
        throw new Error("native notification show failed");
      },
      focusWindow: vi.fn(),
      recordingFileActions: fileActions,
      verifyArtifactIdentity: vi.fn(async () => true),
      scheduleClear: vi.fn(),
    });
    const service = createStreamRecordingService({
      sessionStore,
      createId: () => "recording-native-failure",
      createSectionPath: ownedSectionPath,
      resolvePlayback: vi.fn(async () => ({
        url: "https://cdn.example/live.m3u8",
        format: "hls",
        streamId: "stream-live-123",
      })),
      chooseQuality: vi.fn(),
      chooseSavePath: vi.fn(async () => testVideoPath("stream.mp4")),
      getAvailablePath: (candidate) => candidate,
      resolveFfmpegPath: () => "ffmpeg",
      startRecorder: vi.fn(() => recorder),
      sectionFinalizer: {
        finalize: vi.fn(async () => ({
          outputPath: testVideoPath("stream.mp4"),
          format: "mp4" as const,
          usedFallback: false,
          ownedSectionPaths: [
            ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
          ],
          artifactIdentity,
        })),
      },
      probeArtifact: vi.fn(async () => true),
      verifyArtifactIdentity: vi.fn(async () => true),
      cleanupSections,
      recordingFileActions: fileActions,
      outcomeCoordinator,
    });
    await service.startRecording({ platform: "twitch", channelName: "ninja", title: "Stream" });

    await expect(service.stopRecording("recording-native-failure")).resolves.toEqual({
      success: true,
    });

    expect(sessionStore.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(service.getSnapshot().notice).toMatchObject({ outcome: "completed", delivery: "none" });
    expect(cleanupSections).toHaveBeenCalledWith([
      ownedSectionPath(testVideoPath("stream.mp4"), 1, "recording-session-1"),
    ]);
  });
});
