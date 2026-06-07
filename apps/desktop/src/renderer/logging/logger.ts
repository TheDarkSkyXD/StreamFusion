/**
 * Renderer-process logger — Valo-style.
 *
 * The renderer cannot touch the file system or electron-log directly, so each
 * call ships its structured payload across IPC to the main-process logger via
 * `window.electronAPI.logs.write`. The bridge is fire-and-forget on the
 * renderer side; main owns formatting, redaction, rotation, and on-disk I/O.
 *
 * Defensive paths exist for two situations:
 *   1. Early renderer boot or test/SSR contexts where the contextBridge has
 *      not (yet) populated `window.electronAPI`. We fall back to
 *      `console[level]` so the line is at least visible in devtools.
 *   2. The bridge is wired but the call throws (preload mid-teardown, main
 *      wedged). Same fallback — we never propagate the throw out of a log
 *      call, because callers expect logging to be side-effect free.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(tag: string, message: string, meta?: Record<string, unknown>): void;
  info(tag: string, message: string, meta?: Record<string, unknown>): void;
  warn(tag: string, message: string, meta?: Record<string, unknown>): void;
  error(tag: string, message: string, meta?: Record<string, unknown>): void;
}

interface LogWritePayload {
  level: LogLevel;
  tag: string;
  message: string;
  meta?: Record<string, unknown>;
}

interface ElectronLogsBridge {
  write?: (payload: LogWritePayload) => void;
}

interface ElectronWindowShape {
  electronAPI?: {
    logs?: ElectronLogsBridge;
  };
}

function getBridgeWrite(): ((payload: LogWritePayload) => void) | undefined {
  // `globalThis.window` is undefined in pure-node test contexts; access it
  // through `globalThis` so we don't reference a free `window` identifier
  // that would be a ReferenceError in those contexts.
  const w = (globalThis as unknown as { window?: ElectronWindowShape }).window;
  return w?.electronAPI?.logs?.write;
}

function consoleFallback(
  level: LogLevel,
  tag: string,
  message: string,
  meta?: Record<string, unknown>
): void {
  try {
    const args: unknown[] =
      meta === undefined ? [`[${tag}]`, message] : [`[${tag}]`, message, meta];
    console[level](...args);
  } catch {
    // Both the bridge and the console failed — nothing safe left to do.
  }
}

function emit(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>): void {
  const write = getBridgeWrite();
  if (!write) {
    consoleFallback(level, tag, message, meta);
    return;
  }
  try {
    const payload: LogWritePayload =
      meta === undefined ? { level, tag, message } : { level, tag, message, meta };
    write(payload);
  } catch {
    consoleFallback(level, tag, message, meta);
  }
}

/** Renderer logger — forwards to main via window.electronAPI.logs.write. */
export const logger: Logger = {
  debug: (tag, message, meta) => emit("debug", tag, message, meta),
  info: (tag, message, meta) => emit("info", tag, message, meta),
  warn: (tag, message, meta) => emit("warn", tag, message, meta),
  error: (tag, message, meta) => emit("error", tag, message, meta),
};
