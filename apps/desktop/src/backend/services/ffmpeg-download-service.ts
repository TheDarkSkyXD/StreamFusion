import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import ffmpegStaticPath from "ffmpeg-static";

export class FfmpegUnavailableError extends Error {
  constructor() {
    super("ffmpeg is unavailable. StreamFusion could not find the bundled ffmpeg binary.");
    this.name = "FfmpegUnavailableError";
  }
}

export interface FfmpegPathOptions {
  ffmpegStaticPath?: string | null;
  resourcePath?: string | null;
  exists?: (candidate: string) => boolean;
}

export interface FfmpegProgress {
  percent: number | null;
  transferredSeconds: number;
  totalSeconds: number | null;
  outputBytes?: number | null;
}

interface FfmpegProcess {
  stderr: { on(event: "data", listener: (chunk: unknown) => void): unknown };
  stdin: {
    write(chunk: string): unknown;
    on?(event: "error", listener: (error: Error) => void): unknown;
    removeListener?(event: "error", listener: (error: Error) => void): unknown;
  };
  kill(signal?: NodeJS.Signals | number): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: { windowsHide: boolean }
) => FfmpegProcess;

export function resolveFfmpegPath({
  ffmpegStaticPath: staticPath = ffmpegStaticPath,
  resourcePath = process.resourcesPath,
  exists = existsSync,
}: FfmpegPathOptions = {}): string {
  const unpackedStaticPath = staticPath?.replace(
    /([\\/])app\.asar([\\/])/,
    "$1app.asar.unpacked$2"
  );
  const candidates = [
    unpackedStaticPath !== staticPath ? unpackedStaticPath : null,
    staticPath,
    resourcePath ? path.join(resourcePath, "ffmpeg.exe") : null,
    resourcePath ? path.join(resourcePath, "ffmpeg") : null,
    "ffmpeg",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }

  throw new FfmpegUnavailableError();
}

function parseTimeSeconds(value: string): number {
  const [hours = "0", minutes = "0", seconds = "0"] = value.split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function parseOutputBytes(line: string): number | null {
  const match = line.match(/size=\s*(\d+(?:\.\d+)?)\s*([kmgt]?i?b)?/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  const unit = (match[2] ?? "b").toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    tb: 1024 ** 4,
    tib: 1024 ** 4,
  };

  return Math.round(value * (multipliers[unit] ?? 1));
}

export function parseFfmpegProgress(
  line: string,
  durationSeconds: number | null
): FfmpegProgress | null {
  const match = line.match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  const outputBytes = parseOutputBytes(line);
  if (!match && outputBytes === null) return null;
  const transferredSeconds = match ? parseTimeSeconds(match[1]) : 0;
  return {
    percent: durationSeconds ? (transferredSeconds / durationSeconds) * 100 : null,
    transferredSeconds,
    totalSeconds: durationSeconds,
    ...(outputBytes !== null ? { outputBytes } : {}),
  };
}

function buildArgs(inputUrl: string, outputPath: string): string[] {
  return [
    "-hide_banner",
    "-y",
    "-i",
    inputUrl,
    "-c",
    "copy",
    "-bsf:a",
    "aac_adtstoasc",
    outputPath,
  ];
}

function buildRecordingArgs(inputUrl: string, outputPath: string): string[] {
  return [
    "-hide_banner",
    "-n",
    "-i",
    inputUrl,
    "-map",
    "0",
    "-c",
    "copy",
    "-f",
    "mpegts",
    outputPath,
  ];
}

async function runFfmpeg({
  ffmpegPath,
  args,
  signal,
  durationSeconds,
  onProgress,
  spawnProcess,
}: {
  ffmpegPath: string;
  args: string[];
  signal: AbortSignal;
  durationSeconds: number | null;
  onProgress: (progress: FfmpegProgress) => void;
  spawnProcess: SpawnProcess;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawnProcess(ffmpegPath, args, { windowsHide: true });
    const abort = () => {
      child.kill("SIGTERM");
      reject(new Error("Download cancelled"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    child.stderr.on("data", (chunk) => {
      const progress = parseFfmpegProgress(String(chunk), durationSeconds);
      if (progress) onProgress(progress);
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", abort);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    child.on("error", (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

export async function downloadHlsWithFfmpeg({
  ffmpegPath,
  inputUrl,
  destinationPath,
  durationSeconds = null,
  signal,
  onProgress,
  spawnProcess = (command, args, options) => spawn(command, args, options),
}: {
  ffmpegPath: string;
  inputUrl: string;
  destinationPath: string;
  durationSeconds?: number | null;
  signal: AbortSignal;
  onProgress: (progress: FfmpegProgress) => void;
  spawnProcess?: SpawnProcess;
}): Promise<{ outputPath: string; format: "mp4" | "ts"; outputBytes?: number }> {
  async function resultFor(
    outputPath: string,
    format: "mp4" | "ts"
  ): Promise<{ outputPath: string; format: "mp4" | "ts"; outputBytes?: number }> {
    try {
      return { outputPath, format, outputBytes: (await stat(outputPath)).size };
    } catch {
      return { outputPath, format };
    }
  }

  try {
    await runFfmpeg({
      ffmpegPath,
      args: buildArgs(inputUrl, destinationPath),
      signal,
      durationSeconds,
      onProgress,
      spawnProcess,
    });
    return resultFor(destinationPath, "mp4");
  } catch (error) {
    if (signal.aborted) throw error;
    const fallbackPath = destinationPath.replace(/\.[^.\\/]+$/, ".ts");
    await runFfmpeg({
      ffmpegPath,
      args: buildArgs(inputUrl, fallbackPath),
      signal,
      durationSeconds,
      onProgress,
      spawnProcess,
    });
    return resultFor(fallbackPath, "ts");
  }
}

export function startHlsRecordingWithFfmpeg({
  ffmpegPath,
  inputUrl,
  destinationPath,
  onProgress,
  spawnProcess = (command, args, options) => spawn(command, args, options),
  exists = existsSync,
  statFile = stat,
  gracefulStopTimeoutMs = 2_000,
  forcedCloseTimeoutMs = 2_000,
}: {
  ffmpegPath: string;
  inputUrl: string;
  destinationPath: string;
  onProgress: (progress: { elapsedSeconds: number }) => void;
  spawnProcess?: SpawnProcess;
  exists?: (candidate: string) => boolean;
  statFile?: (candidate: string) => Promise<{ size: number }>;
  gracefulStopTimeoutMs?: number;
  forcedCloseTimeoutMs?: number;
}): {
  stop(): Promise<{ outputPath: string; format: "ts"; partial: boolean }>;
  done: Promise<{ outputPath: string; format: "ts"; partial: boolean }>;
} {
  if (exists(destinationPath)) {
    throw new Error("Recording section already exists");
  }
  const child = spawnProcess(ffmpegPath, buildRecordingArgs(inputUrl, destinationPath), {
    windowsHide: true,
  });
  let stopRequested = false;
  let forcedStop = false;
  let childError: Error | undefined;
  let stopPromise: Promise<{ outputPath: string; format: "ts"; partial: boolean }> | undefined;
  const done = new Promise<{ outputPath: string; format: "ts"; partial: boolean }>(
    (resolve, reject) => {
      child.stderr.on("data", (chunk) => {
        const progress = parseFfmpegProgress(String(chunk), null);
        if (progress) onProgress({ elapsedSeconds: progress.transferredSeconds });
      });
      child.on("close", async (code) => {
        if (forcedStop) {
          reject(new Error("ffmpeg was forced to stop before finalizing the recording section"));
          return;
        }
        if (childError) {
          reject(childError);
          return;
        }
        if (code !== 0) {
          reject(new Error(`ffmpeg exited with code ${code}`));
          return;
        }
        try {
          const output = await statFile(destinationPath);
          if (output.size <= 0) throw new Error("Recording section is empty");
          resolve({ outputPath: destinationPath, format: "ts", partial: stopRequested });
        } catch (error) {
          reject(error);
        }
      });
      child.on("error", (error) => {
        childError = error;
      });
    }
  );

  return {
    stop: () => {
      if (stopPromise) return stopPromise;
      stopRequested = true;
      stopPromise = new Promise((resolve, reject) => {
        let forcedCloseTimer: ReturnType<typeof setTimeout> | undefined;
        const onStdinError = () => {
          clearTimeout(gracefulTimer);
          requestForcedStop();
        };
        const clearStopTimers = () => {
          clearTimeout(gracefulTimer);
          if (forcedCloseTimer) clearTimeout(forcedCloseTimer);
          child.stdin.removeListener?.("error", onStdinError);
        };
        const requestForcedStop = () => {
          if (forcedStop) return;
          forcedStop = true;
          try {
            child.kill("SIGTERM");
          } catch {
            // A failed signal is not proof that the child has closed.
          }
          // timer-allowlist: hard-stop escalation still waits for confirmed child close
          forcedCloseTimer = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              // Only the child close event is terminal.
            }
          }, forcedCloseTimeoutMs);
        };
        // timer-allowlist: ffmpeg stop watchdog is cancelled when the child exits
        const gracefulTimer = setTimeout(requestForcedStop, gracefulStopTimeoutMs);
        child.stdin.on?.("error", onStdinError);
        void done.then(
          (result) => {
            clearStopTimers();
            resolve(result);
          },
          (error) => {
            clearStopTimers();
            reject(error);
          }
        );
        try {
          child.stdin.write("q\n");
        } catch {
          clearTimeout(gracefulTimer);
          requestForcedStop();
        }
      });
      return stopPromise;
    },
    done,
  };
}
