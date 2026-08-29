import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  downloadHlsWithFfmpeg,
  FfmpegUnavailableError,
  parseFfmpegProgress,
  resolveFfmpegPath,
  type SpawnProcess,
  startHlsRecordingWithFfmpeg,
} from "@backend/services/ffmpeg-download-service";

function createProcess({ code = 0, stderr = "" }: { code?: number; stderr?: string }) {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter;
    stdin: { write: (chunk: string) => unknown };
    kill: ReturnType<typeof vi.fn>;
  };
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(() => true) };
  child.kill = vi.fn();
  queueMicrotask(() => {
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code);
  });
  return child;
}

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
