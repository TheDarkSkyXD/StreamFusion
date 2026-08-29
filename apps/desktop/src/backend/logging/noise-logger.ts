/**
 * Noise side-channel logger — separate electron-log instance for high-volume
 * events (HLS segments, chat-stream throughput, player ticks) that would
 * otherwise drown out the main session log.
 *
 * Mirrors the main logger's API and on-disk line format (we reuse `formatLine`
 * from `./logger`), but writes to its own file
 * `streamfusion-noise-<stamp>.log` via a dedicated `electronLog.create({
 * logId: 'noise' })` instance with its own transports — so the two loggers
 * cannot cross-contaminate.
 *
 * The singleton's lifecycle is owned by `main.ts`. Other backend modules
 * import `noiseLogger` and call its level methods; they must not touch
 * electron-log directly.
 */

import fs from "node:fs";
import path from "node:path";

// IMPORTANT: main-process only. See logger.ts for why — same rule applies.
import electronLog from "electron-log/main";

import { formatLine, type Logger, type LogLevel } from "@backend/logging/logger";

export interface InitNoiseOpts {
  logsDir: string;
  sessionStamp: string;
  level?: LogLevel;
}

const VALID_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"] as const;

type ElectronLogInstance = ReturnType<typeof electronLog.create>;

interface NoiseState {
  initialized: boolean;
  shutDown: boolean;
  filePath: string;
  instance: ElectronLogInstance | null;
}

const state: NoiseState = {
  initialized: false,
  shutDown: false,
  filePath: "",
  instance: null,
};

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && (VALID_LEVELS as readonly string[]).includes(value);
}

function sessionStampToFileName(sessionStamp: string): string {
  // Match the main logger's convention: replace `:` and `.` with `-` so the
  // file name is Windows-safe and visually consistent with the main file.
  return `streamfusion-noise-${sessionStamp.replace(/[:.]/g, "-")}.log`;
}

function writeRaw(level: LogLevel, line: string): void {
  // Our format string `'{text}'` makes the file/console transports emit
  // `data[0]` verbatim, so a raw string is enough — no template interp.
  const inst = state.instance;
  if (inst === null) return;
  inst[level](line);
}

function emit(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>): void {
  if (!state.initialized) {
    throw new Error("Noise logger is not initialized — call initNoiseLogger() first.");
  }
  const line = formatLine({
    timestamp: new Date().toISOString(),
    level,
    tag,
    message,
    meta,
  });
  writeRaw(level, line);
}

export const noiseLogger: Logger = {
  debug: (tag, message, meta) => emit("debug", tag, message, meta),
  info: (tag, message, meta) => emit("info", tag, message, meta),
  warn: (tag, message, meta) => emit("warn", tag, message, meta),
  error: (tag, message, meta) => emit("error", tag, message, meta),
};

export function initNoiseLogger(opts: InitNoiseOpts): void {
  if (state.initialized) return;

  fs.mkdirSync(opts.logsDir, { recursive: true });

  const envLevel = process.env.STREAMFUSION_NOISE_LOG_LEVEL;
  const effectiveLevel: LogLevel = isLogLevel(envLevel) ? envLevel : (opts.level ?? "info");

  const fileName = sessionStampToFileName(opts.sessionStamp);
  const filePath = path.join(opts.logsDir, fileName);

  // Separate electron-log instance keyed by `logId` — has its own transports
  // independent of the main `electronLog` default instance.
  const inst = electronLog.create({ logId: "noise" });

  inst.transports.file.resolvePathFn = () => filePath;
  inst.transports.file.format = "{text}";
  inst.transports.console.format = "{text}";
  inst.transports.file.level = effectiveLevel;
  // Console transport stays on but only for warn+ so the dev terminal isn't
  // flooded by noise lines — the file gets everything at `effectiveLevel`.
  inst.transports.console.level = "warn";
  if (inst.transports.ipc) {
    inst.transports.ipc.level = false;
  }
  if (inst.transports.remote) {
    inst.transports.remote.level = false;
  }

  state.initialized = true;
  state.shutDown = false;
  state.filePath = filePath;
  state.instance = inst;

  // Pointer file — same convention as the main logger; see logger.ts for the
  // rationale. Best-effort: never block init on disk failure.
  try {
    fs.writeFileSync(path.join(opts.logsDir, "streamfusion-noise-current.log.path"), filePath, {
      encoding: "utf8",
    });
  } catch (error) {
    console.warn("[noise-logger] Failed to write streamfusion-noise-current.log.path:", error);
  }

  // Header is written at level=info so it always passes the transport filter.
  writeRaw("info", `=== Noise debug started ${opts.sessionStamp} (level=${effectiveLevel}) ===`);
}

export function getCurrentNoisePath(): string {
  if (!state.initialized) {
    throw new Error("Noise logger is not initialized — call initNoiseLogger() first.");
  }
  return state.filePath;
}

export async function shutdownNoiseLogger(): Promise<void> {
  if (!state.initialized || state.shutDown) return;
  state.shutDown = true;
  writeRaw("info", `=== Noise debug closed ${new Date().toISOString()} ===`);
  await Promise.resolve();
}
