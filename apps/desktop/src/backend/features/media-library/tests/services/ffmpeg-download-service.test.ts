import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  downloadHlsWithFfmpeg,
  FfmpegUnavailableError,
  type FfmpegProgress,
  parseFfmpegProgress,
  resolveFfmpegPath,
  type SpawnProcess,
  startHlsRecordingWithFfmpeg,
} from "@backend/features/media-library/adapters/ffmpeg/ffmpeg-download-service";

function createProcess({ code = 0, stderr = "" }: { code?: number; stderr?: string | string[] }) {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    stdin: { write: (chunk: string) => unknown };
    kill: (signal?: NodeJS.Signals | number) => unknown;
  };
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(() => true) };
  child.kill = vi.fn((_signal?: NodeJS.Signals | number) => true);
  queueMicrotask(() => {
    for (const chunk of Array.isArray(stderr) ? stderr : [stderr]) {
      if (chunk) child.stderr.emit("data", Buffer.from(chunk));
    }
    child.emit("close", code);
  });
  return child;
}

async function captureDownloadProgress({
  stderr,
  durationSeconds = null,
}: {
  stderr: string | string[];
  durationSeconds?: number | null;
}): Promise<FfmpegProgress[]> {
  const progress: FfmpegProgress[] = [];
  await downloadHlsWithFfmpeg({
    ffmpegPath: "ffmpeg",
    inputUrl: "https://cdn.example/vod.m3u8",
    destinationPath: "D:\\Videos\\vod.mp4",
    durationSeconds,
    signal: new AbortController().signal,
    onProgress: (update) => progress.push(update),
    spawnProcess: vi.fn<SpawnProcess>(() => createProcess({ stderr })),
  });
  return progress;
}

// Guards: download progress reassembles fragmented stderr records and handles every coalesced record.
// Guards: inferred duration ignores unknown metadata and never replaces a supplied duration.
// Guards: download percentages stay between zero and 100.
// Guards: recording shutdown waits for child close even when stdin fails synchronously or asynchronously.
describe("ffmpeg download service", () => {
  it("resolves a bundled ffmpeg-static path before PATH fallback", () => {
    expect(
      resolveFfmpegPath({
        ffmpegStaticPath: "C:\\app\\node_modules\\ffmpeg-static\\ffmpeg.exe",
        exists: (candidate) => candidate.includes("ffmpeg-static"),
      })
    ).toBe("C:\\app\\node_modules\\ffmpeg-static\\ffmpeg.exe");
  });

  it("resolves packaged ffmpeg from the unpacked ASAR path", () => {
    const packagedPath =
      "C:\\Program Files\\StreamFusion\\resources\\app.asar\\node_modules\\ffmpeg-static\\ffmpeg.exe";
    const unpackedPath = packagedPath.replace("app.asar", "app.asar.unpacked");

    expect(
      resolveFfmpegPath({
        ffmpegStaticPath: packagedPath,
        exists: (candidate) => candidate === unpackedPath,
      })
    ).toBe(unpackedPath);
  });

  it("throws a clear unavailable error when no ffmpeg binary can be found", () => {
    expect(() =>
      resolveFfmpegPath({
        ffmpegStaticPath: null,
        exists: () => false,
      })
    ).toThrow(FfmpegUnavailableError);
  });

  it("parses ffmpeg time progress into a percent", () => {
    expect(parseFfmpegProgress("frame=1 time=00:01:30.00 bitrate=1", 180)).toEqual({
      percent: 50,
      transferredSeconds: 90,
      totalSeconds: 180,
    });
  });

  it("parses ffmpeg output size into bytes", () => {
    expect(parseFfmpegProgress("size=  12.5MiB time=00:00:30.00 bitrate=1", 60)).toMatchObject({
      percent: 50,
      transferredSeconds: 30,
      totalSeconds: 60,
      outputBytes: 13_107_200,
    });
  });

  it("reassembles fragmented stderr records before reporting progress", async () => {
    const progress = await captureDownloadProgress({
      stderr: [
        "  Duration: 00:01",
        ":00.00, start: 0.000000, bitrate: N/A\r",
        "\nframe=1 time=00:00",
        ":30.00 bitrate=1\r",
        "\n",
      ],
    });

    expect(progress).toEqual([
      {
        percent: 50,
        transferredSeconds: 30,
        totalSeconds: 60,
      },
    ]);
  });

  it("reports every progress record coalesced into one stderr chunk", async () => {
    const progress = await captureDownloadProgress({
      stderr:
        "Duration: 00:00:40.00, start: 0.000000, bitrate: N/A\n" +
        "frame=1 time=00:00:10.00 bitrate=1\rframe=2 time=00:00:20.00 bitrate=1\r",
    });

    expect(progress).toEqual([
      {
        percent: 25,
        transferredSeconds: 10,
        totalSeconds: 40,
      },
      {
        percent: 50,
        transferredSeconds: 20,
        totalSeconds: 40,
      },
    ]);
  });

  it("keeps progress indeterminate when FFmpeg reports an unknown duration", async () => {
    const progress = await captureDownloadProgress({
      stderr:
        "Duration: N/A, start: 0.000000, bitrate: N/A\n" + "frame=1 time=00:00:10.00 bitrate=1\r",
    });

    expect(progress).toEqual([
      {
        percent: null,
        transferredSeconds: 10,
        totalSeconds: null,
      },
    ]);
  });

  it("keeps a supplied duration when FFmpeg reports a different duration", async () => {
    const progress = await captureDownloadProgress({
      durationSeconds: 120,
      stderr:
        "Duration: 00:01:00.00, start: 0.000000, bitrate: N/A\n" +
        "frame=1 time=00:00:30.00 bitrate=1\r",
    });

    expect(progress).toEqual([
      {
        percent: 25,
        transferredSeconds: 30,
        totalSeconds: 120,
      },
    ]);
  });

  it("clamps progress to 100 percent when FFmpeg time exceeds the duration", () => {
    expect(parseFfmpegProgress("frame=1 time=00:02:00.00 bitrate=1", 60)).toEqual({
      percent: 100,
      transferredSeconds: 120,
      totalSeconds: 60,
    });
  });

  it("invokes ffmpeg for mp4 HLS remux and falls back to transport stream output", async () => {
    const spawnProcess = vi
      .fn()
      .mockImplementationOnce(() => createProcess({ code: 1, stderr: "muxer failed" }))
      .mockImplementationOnce(() => createProcess({ code: 0, stderr: "time=00:00:30.00" }));
    const onProgress = vi.fn();

    const result = await downloadHlsWithFfmpeg({
      ffmpegPath: "ffmpeg",
      inputUrl: "https://cdn.example/vod.m3u8",
      destinationPath: "D:\\Videos\\vod.mp4",
      durationSeconds: 60,
      signal: new AbortController().signal,
      onProgress,
      spawnProcess,
    });

    expect(spawnProcess).toHaveBeenNthCalledWith(
      1,
      "ffmpeg",
      expect.arrayContaining(["-i", "https://cdn.example/vod.m3u8", "D:\\Videos\\vod.mp4"]),
      expect.any(Object)
    );
    expect(spawnProcess).toHaveBeenNthCalledWith(
      2,
      "ffmpeg",
      expect.arrayContaining(["D:\\Videos\\vod.ts"]),
      expect.any(Object)
    );
    expect(result).toEqual({ outputPath: "D:\\Videos\\vod.ts", format: "ts" });
    expect(onProgress).toHaveBeenCalledWith({
      percent: 50,
      transferredSeconds: 30,
      totalSeconds: 60,
    });
  });

  it("records crash-tolerant TS staging with no-clobber output semantics", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdin: { write: (chunk: string) => unknown };
      kill: (signal?: NodeJS.Signals | number) => unknown;
    };
    const writeStdin = vi.fn((_chunk: string) => {
      queueMicrotask(() => child.emit("close", 0));
      return true;
    });
    child.stderr = new EventEmitter();
    child.stdin = { write: writeStdin };
    child.kill = vi.fn((_signal?: NodeJS.Signals | number) => {
      return true;
    });
    const spawnProcess = vi.fn<SpawnProcess>(() => child);

    const recorder = startHlsRecordingWithFfmpeg({
      ffmpegPath: "ffmpeg",
      inputUrl: "https://cdn.example/live.m3u8",
      destinationPath: "D:\\Videos\\stream.part-001.ts",
      onProgress: vi.fn(),
      spawnProcess,
      exists: () => false,
      statFile: async () => ({ size: 1024 }),
    });

    await expect(recorder.stop()).resolves.toEqual({
      outputPath: "D:\\Videos\\stream.part-001.ts",
      format: "ts",
      partial: true,
    });
    const args = spawnProcess.mock.calls[0]![1];
    expect(args).toEqual(
      expect.arrayContaining(["-n", "-f", "mpegts", "D:\\Videos\\stream.part-001.ts"])
    );
    expect(args).not.toContain("-y");
    expect(args).not.toContain("aac_adtstoasc");
    expect(writeStdin).toHaveBeenCalledWith("q\n");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("surfaces a forced recording shutdown as failure instead of playable output", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdin: { write: (chunk: string) => unknown };
      kill: (signal?: NodeJS.Signals | number) => unknown;
    };
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(() => true) };
    const kill = vi.fn((_signal?: NodeJS.Signals | number) => {
      queueMicrotask(() => child.emit("close", null));
      return true;
    });
    child.kill = kill;
    const recorder = startHlsRecordingWithFfmpeg({
      ffmpegPath: "ffmpeg",
      inputUrl: "https://cdn.example/live.m3u8",
      destinationPath: "D:\\Videos\\stream.part-001.ts",
      onProgress: vi.fn(),
      spawnProcess: vi.fn<SpawnProcess>(() => child),
      exists: () => false,
      statFile: async () => ({ size: 1024 }),
      gracefulStopTimeoutMs: 25,
      forcedCloseTimeoutMs: 25,
    });

    const stopping = recorder.stop();
    const forcedFailure = expect(stopping).rejects.toThrow("forced to stop");
    await vi.advanceTimersByTimeAsync(25);

    await forcedFailure;
    expect(kill).toHaveBeenCalledWith("SIGTERM");
    vi.useRealTimers();
  });

  it("waits for confirmed child close after graceful-stop stdin fails", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdin: { write: (chunk: string) => unknown };
      kill: (signal?: NodeJS.Signals | number) => unknown;
    };
    child.stderr = new EventEmitter();
    child.stdin = {
      write: vi.fn(() => {
        throw new Error("stdin pipe closed");
      }),
    };
    child.kill = vi.fn(() => true);
    const recorder = startHlsRecordingWithFfmpeg({
      ffmpegPath: "ffmpeg",
      inputUrl: "https://cdn.example/live.m3u8",
      destinationPath: "D:\\Videos\\stream.part-001.ts",
      onProgress: vi.fn(),
      spawnProcess: vi.fn<SpawnProcess>(() => child),
      exists: () => false,
      statFile: async () => ({ size: 1024 }),
    });

    let outcome: "resolved" | "rejected" | undefined;
    const stopping = recorder.stop().then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      }
    );
    await Promise.resolve();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(outcome).toBeUndefined();

    child.emit("close", null);
    await stopping;
    expect(outcome).toBe("rejected");
  });

  it("handles an asynchronous stdin EPIPE and still waits for confirmed child close", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdin: EventEmitter & { write: (chunk: string) => unknown };
      kill: (signal?: NodeJS.Signals | number) => unknown;
    };
    child.stderr = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), { write: vi.fn(() => true) });
    child.kill = vi.fn(() => true);
    const recorder = startHlsRecordingWithFfmpeg({
      ffmpegPath: "ffmpeg",
      inputUrl: "https://cdn.example/live.m3u8",
      destinationPath: "D:\\Videos\\stream.part-001.ts",
      onProgress: vi.fn(),
      spawnProcess: vi.fn<SpawnProcess>(() => child),
      exists: () => false,
      statFile: async () => ({ size: 1024 }),
    });
    let settled = false;

    const stopping = recorder.stop().finally(() => {
      settled = true;
    });
    child.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    await Promise.resolve();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(settled).toBe(false);
    expect(child.stdin.listenerCount("error")).toBe(1);

    child.emit("close", null);
    await expect(stopping).rejects.toThrow("forced to stop");
    expect(child.stdin.listenerCount("error")).toBe(0);
  });

  it("escalates a forced-stop timeout and remains pending until child close", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdin: { write: (chunk: string) => unknown };
      kill: (signal?: NodeJS.Signals | number) => unknown;
    };
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(() => true) };
    child.kill = vi.fn(() => true);
    const recorder = startHlsRecordingWithFfmpeg({
      ffmpegPath: "ffmpeg",
      inputUrl: "https://cdn.example/live.m3u8",
      destinationPath: "D:\\Videos\\stream.part-001.ts",
      onProgress: vi.fn(),
      spawnProcess: vi.fn<SpawnProcess>(() => child),
      exists: () => false,
      statFile: async () => ({ size: 1024 }),
      gracefulStopTimeoutMs: 25,
      forcedCloseTimeoutMs: 25,
    });

    let outcome: "resolved" | "rejected" | undefined;
    const stopping = recorder.stop().then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      }
    );
    await vi.advanceTimersToNextTimerAsync();
    expect(child.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    await vi.advanceTimersToNextTimerAsync();
    expect(child.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    expect(outcome).toBeUndefined();

    child.emit("close", null);
    await stopping;
    expect(outcome).toBe("rejected");
    vi.useRealTimers();
  });

  it("does not treat a child error event as terminal before close", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdin: { write: (chunk: string) => unknown };
      kill: (signal?: NodeJS.Signals | number) => unknown;
    };
    child.stderr = new EventEmitter();
    child.stdin = { write: vi.fn(() => true) };
    child.kill = vi.fn(() => true);
    const recorder = startHlsRecordingWithFfmpeg({
      ffmpegPath: "ffmpeg",
      inputUrl: "https://cdn.example/live.m3u8",
      destinationPath: "D:\\Videos\\stream.part-001.ts",
      onProgress: vi.fn(),
      spawnProcess: vi.fn<SpawnProcess>(() => child),
      exists: () => false,
      statFile: async () => ({ size: 1024 }),
    });

    let outcome: "resolved" | "rejected" | undefined;
    const stopping = recorder.stop().then(
      () => {
        outcome = "resolved";
      },
      () => {
        outcome = "rejected";
      }
    );
    child.emit("error", new Error("process transport error"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(outcome).toBeUndefined();

    child.emit("close", 1);
    await stopping;
    expect(outcome).toBe("rejected");
  });
});
