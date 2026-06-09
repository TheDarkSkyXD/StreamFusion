/**
 * Main-process logger — Valo-style format on top of electron-log.
 *
 * Format per line: `[ISO-timestamp] [level] [Tag] message[ {meta-json}]`
 * Why electron-log: it already handles fsync-on-quit, sync file writes, and
 * cross-platform path quirks. We override its template to take full control
 * of the on-disk shape via a single `{text}` slot — our formatter computes
 * the whole line and passes it as the only data argument.
 *
 * The singleton's lifecycle is owned by `main.ts`. Other backend modules
 * import `logger` and call its level methods; they must not touch
 * electron-log directly.
 */

import fs from "node:fs";
import path from "node:path";

// IMPORTANT: this module is MAIN-PROCESS ONLY. If renderer-reachable backend
// code starts importing `@/backend/logging/logger`, Vite will bundle this
// file into the renderer, and the static `import "electron-log/main"` below
// drags electron-log in too — which crashes the renderer at module load
// (`__dirname is not defined`). Dual-use files (those imported by both main
// and renderer) MUST import from `@/lib/cross-logger` instead.
import electronLog from "electron-log/main";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface InitLoggerOpts {
  logsDir: string;
  sessionStamp: string;
  level?: LogLevel;
}

export interface Logger {
  debug(tag: string, message: string, meta?: Record<string, unknown>): void;
  info(tag: string, message: string, meta?: Record<string, unknown>): void;
  warn(tag: string, message: string, meta?: Record<string, unknown>): void;
  error(tag: string, message: string, meta?: Record<string, unknown>): void;
}

export type LogSink = (entry: {
  level: LogLevel;
  tag: string;
  message: string;
  meta?: Record<string, unknown>;
  line: string;
}) => void;

const VALID_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"] as const;

interface LoggerState {
  initialized: boolean;
  shutDown: boolean;
  filePath: string;
}

const state: LoggerState = {
  initialized: false,
  shutDown: false,
  filePath: "",
};

const sinks = new Set<LogSink>();

function isLogLevel(value: string | undefined): value is LogLevel {
  return value !== undefined && (VALID_LEVELS as readonly string[]).includes(value);
}

function sessionStampToFileName(sessionStamp: string): string {
  // ISO-8601 timestamps contain colons that are illegal in Windows file names
  // and a `.` before milliseconds that is harmless but Valo's convention
  // hyphenates anyway for visual consistency (25.011Z → 25-011Z).
  return `streamfusion-${sessionStamp.replace(/[:.]/g, "-")}.log`;
}

export function formatLine(opts: {
  timestamp: string;
  level: LogLevel;
  tag: string;
  message: string;
  meta?: Record<string, unknown>;
}): string {
  const { timestamp, level, tag, message, meta } = opts;
  const base = `[${timestamp}] [${level}] [${tag}] ${message}`;
  if (meta === undefined) return base;
  return `${base} ${JSON.stringify(meta)}`;
}

function writeRaw(level: LogLevel, line: string): void {
  // electron-log's format `'{text}'` makes the file/console transports emit
  // our `data[0]` verbatim, so a raw string is enough — no template interp.
  electronLog[level](line);
}

function emit(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>): void {
  if (!state.initialized) {
    throw new Error("Logger is not initialized — call initLogger() first.");
  }
  const line = formatLine({
    timestamp: new Date().toISOString(),
    level,
    tag,
    message,
    meta,
  });
  writeRaw(level, line);
  for (const sink of sinks) {
    try {
      sink({ level, tag, message, meta, line });
    } catch {
      // Side-channel diagnostics must never break the primary logger.
    }
  }
}

export const logger: Logger = {
  debug: (tag, message, meta) => emit("debug", tag, message, meta),
  info: (tag, message, meta) => emit("info", tag, message, meta),
  warn: (tag, message, meta) => emit("warn", tag, message, meta),
  error: (tag, message, meta) => emit("error", tag, message, meta),
};

export function initLogger(opts: InitLoggerOpts): void {
  if (state.initialized) return;

  fs.mkdirSync(opts.logsDir, { recursive: true });

  const envLevel = process.env.STREAMFUSION_LOG_LEVEL;
  const effectiveLevel: LogLevel = isLogLevel(envLevel) ? envLevel : (opts.level ?? "info");

  const fileName = sessionStampToFileName(opts.sessionStamp);
  const filePath = path.join(opts.logsDir, fileName);

  // Install resolvePathFn before any log call so electron-log never tries to
  // compute its own default path (which would require a fully initialized
  // Electron `app`).
  electronLog.transports.file.resolvePathFn = () => filePath;
  electronLog.transports.file.format = "{text}";
  electronLog.transports.console.format = "{text}";
  electronLog.transports.file.level = effectiveLevel;
  electronLog.transports.console.level = effectiveLevel;
  if (electronLog.transports.ipc) {
    // The IPC transport mirrors logs to renderer devtools; not desired here.
    electronLog.transports.ipc.level = false;
  }
  if (electronLog.transports.remote) {
    electronLog.transports.remote.level = false;
  }

  state.initialized = true;
  state.shutDown = false;
  state.filePath = filePath;

  // Pointer file — one-line text file containing the absolute path of THIS
  // session's log. AI agents and the streamfusion-debug skill read this to
  // locate the active log without globbing for the newest timestamp.
  // Best-effort: a disk-full / perm error must not block logger init.
  try {
    fs.writeFileSync(path.join(opts.logsDir, "streamfusion-current.log.path"), filePath, {
      encoding: "utf8",
    });
  } catch (error) {
    // electron-log isn't ready to receive lines yet; use the raw console.
    console.warn("[logger] Failed to write streamfusion-current.log.path:", error);
  }

  // Header is written at level=info so it always passes the transport filter
  // (info is always >= our supported minimum levels).
  writeRaw("info", `=== Debug started ${opts.sessionStamp} (level=${effectiveLevel}) ===`);
}

export function getCurrentLogPath(): string {
  if (!state.initialized) {
    throw new Error("Logger is not initialized — call initLogger() first.");
  }
  return state.filePath;
}

export function addLogSink(sink: LogSink): () => void {
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

export async function shutdownLogger(): Promise<void> {
  if (!state.initialized || state.shutDown) return;
  state.shutDown = true;
  writeRaw("info", `=== Debug closed ${new Date().toISOString()} ===`);
  // electron-log 5.x writes synchronously by default (`file.sync = true`), so
  // no explicit flush is required. A microtask yield is enough to let any
  // pending hook chain unwind before the caller proceeds.
  await Promise.resolve();
}
