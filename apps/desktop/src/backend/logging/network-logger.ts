/**
 * Network side-channel logger.
 *
 * Captures network-relevant diagnostics into `streamfusion-network-<stamp>.log`
 * so stream-load, WebRTC/TURN, status-page, manifest, and websocket issues can
 * be inspected without hunting through the full main session log.
 */

import fs from "node:fs";
import path from "node:path";

import electronLog from "electron-log/main";

import { formatLine, type Logger, type LogLevel } from "@backend/logging/logger";

export interface InitNetworkOpts {
  logsDir: string;
  sessionStamp: string;
  level?: LogLevel;
}

const VALID_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"] as const;

type ElectronLogInstance = ReturnType<typeof electronLog.create>;

interface NetworkState {
  initialized: boolean;
  shutDown: boolean;
  filePath: string;
  instance: ElectronLogInstance | null;
}

const state: NetworkState = {
  initialized: false,
  shutDown: false,
  filePath: "",
  instance: null,
};

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && (VALID_LEVELS as readonly string[]).includes(value);
}

function sessionStampToFileName(sessionStamp: string): string {
  return `streamfusion-network-${sessionStamp.replace(/[:.]/g, "-")}.log`;
}

function writeRaw(level: LogLevel, line: string): void {
  const inst = state.instance;
  if (inst === null) return;
  inst[level](line);
}

function emit(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>): void {
  if (!state.initialized) {
    throw new Error("Network logger is not initialized - call initNetworkLogger() first.");
  }
  writeRaw(
    level,
    formatLine({
      timestamp: new Date().toISOString(),
      level,
      tag,
      message,
      meta,
    })
  );
}

export const networkLogger: Logger = {
  debug: (tag, message, meta) => emit("debug", tag, message, meta),
  info: (tag, message, meta) => emit("info", tag, message, meta),
  warn: (tag, message, meta) => emit("warn", tag, message, meta),
  error: (tag, message, meta) => emit("error", tag, message, meta),
};

export function initNetworkLogger(opts: InitNetworkOpts): void {
  if (state.initialized) return;

  fs.mkdirSync(opts.logsDir, { recursive: true });

  const envLevel = process.env.STREAMFUSION_NETWORK_LOG_LEVEL;
  const effectiveLevel: LogLevel = isLogLevel(envLevel) ? envLevel : (opts.level ?? "info");

  const filePath = path.join(opts.logsDir, sessionStampToFileName(opts.sessionStamp));
  const inst = electronLog.create({ logId: "network" });

  inst.transports.file.resolvePathFn = () => filePath;
  inst.transports.file.format = "{text}";
  inst.transports.console.format = "{text}";
  inst.transports.file.level = effectiveLevel;
  // Main logger already owns terminal output; this side-channel is file-only.
  inst.transports.console.level = false;
  if (inst.transports.ipc) inst.transports.ipc.level = false;
  if (inst.transports.remote) inst.transports.remote.level = false;

  state.initialized = true;
  state.shutDown = false;
  state.filePath = filePath;
  state.instance = inst;

  try {
    fs.writeFileSync(path.join(opts.logsDir, "streamfusion-network-current.log.path"), filePath, {
      encoding: "utf8",
    });
  } catch (error) {
    console.warn("[network-logger] Failed to write streamfusion-network-current.log.path:", error);
  }

  writeRaw("info", `=== Network debug started ${opts.sessionStamp} (level=${effectiveLevel}) ===`);
}

export function getCurrentNetworkPath(): string {
  if (!state.initialized) {
    throw new Error("Network logger is not initialized - call initNetworkLogger() first.");
  }
  return state.filePath;
}

export async function shutdownNetworkLogger(): Promise<void> {
  if (!state.initialized || state.shutDown) return;
  state.shutDown = true;
  writeRaw("info", `=== Network debug closed ${new Date().toISOString()} ===`);
  await Promise.resolve();
}
