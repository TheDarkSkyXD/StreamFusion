import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  resolveFfmpegPath,
  startHlsRecordingWithFfmpeg,
} from "@/backend/services/ffmpeg-download-service";
import { createOwnedRecordingSectionPath } from "@/backend/services/stream-recording-paths";
import { createStreamRecordingService } from "@/backend/services/stream-recording-service";
import { createStreamRecordingSessionStore } from "@/backend/services/stream-recording-session-store";
import type { StreamRecordingJournal } from "@/shared/stream-recording-types";

const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

function validateMedia(ffmpegPath: string, mediaPath: string) {
  return spawnSync(ffmpegPath, ["-v", "error", "-i", mediaPath, "-f", "null", "-"], {
    encoding: "utf8",
    windowsHide: true,
  });
}

async function waitForFileBytes(filePath: string, minimumBytes: number): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (existsSync(filePath) && statSync(filePath).size >= minimumBytes) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for capture bytes at ${filePath}`);
}

// Guards: Windows Pause/Stop must leave crash-tolerant staging that the real bundled ffmpeg can finalize.
describe.runIf(process.platform === "win32")("Windows Stream Recording playability", () => {
  it("resumes an interrupted real TS capture and finalizes it into one playable output", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-'playable'-"));
    temporaryDirectories.push(directory);
    const ffmpegPath = resolveFfmpegPath();
    const sourcePath = path.join(directory, "source.ts");
    const generated = spawnSync(
      ffmpegPath,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=160x90:rate=25",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=48000",
        "-t",
        "8",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-g",
        "25",
        "-c:a",
        "aac",
        "-f",
        "mpegts",
        sourcePath,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    expect(generated.status, generated.stderr).toBe(0);
    const source = readFileSync(sourcePath);
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "video/mp2t" });
      let offset = 0;
      const timer = setInterval(() => {
        const nextOffset = Math.min(offset + 188 * 5, source.length);
        response.write(source.subarray(offset, nextOffset));
        offset = nextOffset;
        if (offset === source.length) {
          offset = 0;
        }
      }, 5);
      response.on("close", () => clearInterval(timer));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      let journal: StreamRecordingJournal = { version: 1, session: null };
      const sessionStore = createStreamRecordingSessionStore({
        storage: {
          getStreamRecordingJournal: () => journal,
          saveStreamRecordingJournal: (next) => {
            journal = structuredClone(next);
          },
        },
      });
      const destinationPath = path.join(directory, "finished.mp4");
      const service = createStreamRecordingService({
        sessionStore,
        createId: () => "windows-playability",
        resolvePlayback: vi.fn(async () => ({
          url: `http://127.0.0.1:${address.port}/live.ts`,
          format: "hls",
          streamId: "windows-stream-1",
        })),
        chooseQuality: vi.fn(),
        chooseSavePath: vi.fn(async () => destinationPath),
        getAvailablePath: (candidate) => candidate,
        resolveFfmpegPath: () => ffmpegPath,
        startRecorder: startHlsRecordingWithFfmpeg,
        scheduleNoticeClear: vi.fn(),
      });

      await service.startRecording({ platform: "twitch", channelName: "test", title: "Test" });
      const firstSection = sessionStore.getJournal().session?.sections[0]?.path;
      expect(firstSection).toBeTruthy();
      await waitForFileBytes(firstSection!, 10_000);
      await expect(service.pauseRecording("windows-playability")).resolves.toEqual({
        success: true,
      });
      const pausedSection = sessionStore.getJournal().session?.sections[0]?.path;
      expect(pausedSection).toBeTruthy();
      const pausedValidation = validateMedia(ffmpegPath, pausedSection!);
      expect(pausedValidation.status, pausedValidation.stderr).toBe(0);
      const pausedSectionBytes = statSync(pausedSection!).size;

      const restartedStore = createStreamRecordingSessionStore({
        storage: {
          getStreamRecordingJournal: () => journal,
          saveStreamRecordingJournal: (next) => {
            journal = structuredClone(next);
          },
        },
      });
      const restartedService = createStreamRecordingService({
        sessionStore: restartedStore,
        resolvePlayback: vi.fn(async () => ({
          url: `http://127.0.0.1:${address.port}/live.ts`,
          format: "hls",
          streamId: "windows-stream-1",
        })),
        chooseQuality: vi.fn(),
        chooseSavePath: vi.fn(),
        getAvailablePath: (candidate) => candidate,
        resolveFfmpegPath: () => ffmpegPath,
        startRecorder: startHlsRecordingWithFfmpeg,
        scheduleNoticeClear: vi.fn(),
      });
      expect(restartedStore.getSnapshot().active?.status).toBe("interrupted");
      await expect(restartedService.resumeInterrupted("windows-playability")).resolves.toEqual({
        success: true,
      });
      const resumedSection = restartedStore.getJournal().session?.sections[1]?.path;
      expect(resumedSection).toBeTruthy();
      await waitForFileBytes(resumedSection!, 10_000);
      await expect(restartedService.stopRecording("windows-playability")).resolves.toEqual({
        success: true,
      });

      const notice = restartedService.getSnapshot().notice;
      expect(notice).toMatchObject({ outcome: "completed", outputFormat: "mp4" });
      if (!notice || notice.outcome !== "completed") {
        throw new Error("Expected a completed recording outcome");
      }
      expect(notice?.outputPath && existsSync(notice.outputPath)).toBe(true);
      const outputValidation = validateMedia(ffmpegPath, notice!.outputPath!);
      expect(outputValidation.status, outputValidation.stderr).toBe(0);
      expect(restartedStore.getJournal().session).toBeNull();
      expect(existsSync(pausedSection!)).toBe(false);

      const partialDestination = path.join(directory, "partial.mp4");
      const partialSessionId = "windows-partial-recovery";
      const partialSection = createOwnedRecordingSectionPath(
        partialDestination,
        partialSessionId,
        1
      );
      writeFileSync(partialSection, source);
      const createdAt = new Date(Date.now() - 2_000).toISOString();
      const updatedAt = new Date(Date.now() - 1_000).toISOString();
      let partialJournal: StreamRecordingJournal = {
        version: 2,
        state: "interrupted",
        session: {
          id: partialSessionId,
          platform: "twitch",
          channelName: "test",
          title: "Recovered test",
          status: "interrupted",
          destinationPath: partialDestination,
          qualityLabel: "Source",
          desiredQuality: { quality: "Source", isSource: true },
          currentQuality: { quality: "Source", isSource: true },
          qualityChange: null,
          capturedDurationSeconds: 8,
          sections: [
            {
              id: `${partialSessionId}-part-1`,
              path: partialSection,
              startedAt: createdAt,
              endedAt: updatedAt,
            },
          ],
          gaps: [{ startedAt: updatedAt, reason: "restart" }],
          createdAt,
          updatedAt,
          partial: true,
        },
      };
      const partialStore = createStreamRecordingSessionStore({
        storage: {
          getStreamRecordingJournal: () => partialJournal,
          saveStreamRecordingJournal: (next) => {
            partialJournal = structuredClone(next);
          },
        },
      });
      const partialService = createStreamRecordingService({
        sessionStore: partialStore,
        resolvePlayback: vi.fn(),
        chooseQuality: vi.fn(),
        chooseSavePath: vi.fn(),
        getAvailablePath: (candidate) => candidate,
        resolveFfmpegPath: () => ffmpegPath,
        startRecorder: startHlsRecordingWithFfmpeg,
        scheduleNoticeClear: vi.fn(),
      });
      await expect(partialService.finalizeInterrupted(partialSessionId)).resolves.toEqual({
        success: true,
      });
      const partialNotice = partialService.getSnapshot().notice;
      expect(partialNotice).toMatchObject({ outcome: "partial", outputFormat: "mp4" });
      if (partialNotice?.outcome !== "partial") {
        throw new Error("Expected recovered partial output");
      }
      const partialValidation = validateMedia(ffmpegPath, partialNotice.outputPath);
      expect(partialValidation.status, partialValidation.stderr).toBe(0);
      expect(partialStore.getJournal().session).toBeNull();

      console.info("Windows recording playability", {
        pausedSectionBytes,
        outputBytes: statSync(notice!.outputPath!).size,
        outputFormat: notice!.outputFormat,
        pausedValidationStatus: pausedValidation.status,
        outputValidationStatus: outputValidation.status,
        partialValidationStatus: partialValidation.status,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }, 120_000);

  it("refuses to overwrite an existing staging section with the real bundled ffmpeg", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "streamfusion-collision-"));
    temporaryDirectories.push(directory);
    const ffmpegPath = resolveFfmpegPath();
    const sourcePath = path.join(directory, "source.ts");
    const destinationPath = path.join(directory, "reserved.ts");
    const generated = spawnSync(
      ffmpegPath,
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=64x64:rate=10",
        "-t",
        "1",
        "-c:v",
        "libx264",
        "-f",
        "mpegts",
        sourcePath,
      ],
      { encoding: "utf8", windowsHide: true }
    );
    expect(generated.status, generated.stderr).toBe(0);
    writeFileSync(destinationPath, "do-not-overwrite", { flag: "wx" });

    expect(() =>
      startHlsRecordingWithFfmpeg({
        ffmpegPath,
        inputUrl: sourcePath,
        destinationPath,
        onProgress: vi.fn(),
      })
    ).toThrow("Recording section already exists");
    expect(readFileSync(destinationPath, "utf8")).toBe("do-not-overwrite");
  });
});
