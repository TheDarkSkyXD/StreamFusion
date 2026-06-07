/**
 * Cross-process logger — for code paths reachable from BOTH main and renderer.
 *
 * Pure backend code should import `@/backend/logging/logger` directly. But a
 * handful of files under `backend/` (e.g. mod-log-writer) are also imported by
 * renderer components, and `@/backend/logging/logger` pulls in `electron-log`
 * which crashes the renderer at load time (`__dirname is not defined`).
 *
 * This module has NO Node or Electron imports, so it is safe to drag into the
 * renderer bundle. At runtime it picks the right sink:
 *   - Main process: `main.ts` calls `setMainLogSink(...)` early in boot;
 *     subsequent calls forward straight to the real backend logger.
 *   - Renderer: `window.electronAPI.logs.write` is used to ship lines over IPC.
 *   - Anything else (boot window before sink registration, test contexts,
 *     SSR): falls back to `console[level]` so the line is never silently lost.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(tag: string, message: string, meta?: Record<string, unknown>): void;
  info(tag: string, message: string, meta?: Record<string, unknown>): void;
  warn(tag: string, message: string, meta?: Record<string, unknown>): void;
  error(tag: string, message: string, meta?: Record<string, unknown>): void;
}

export type MainLogSink = (
  level: LogLevel,
  tag: string,
  message: string,
  meta?: Record<string, unknown>
) => void;

let mainSink: MainLogSink | null = null;

/** Called once from `main.ts` after `initLogger` to wire the real backend logger. */
export function setMainLogSink(sink: MainLogSink | null): void {
  mainSink = sink;
}

interface ElectronWindowShape {
  electronAPI?: {
    logs?: {
      write?: (payload: {
        level: LogLevel;
        tag: string;
        message: string;
        meta?: Record<string, unknown>;
      }) => void;
    };
  };
}

function getBridgeWrite():
  | ((payload: {
      level: LogLevel;
      tag: string;
      message: string;
      meta?: Record<string, unknown>;
    }) => void)
  | undefined {
  // `globalThis.window` is undefined in pure-node contexts. Access it through
  // `globalThis` so the symbol resolves even when `window` is not declared.
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
    // Both the sink/bridge and console failed — nothing safe left to do.
  }
}

function emit(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>): void {
  if (mainSink) {
    try {
      mainSink(level, tag, message, meta);
      return;
    } catch {
      consoleFallback(level, tag, message, meta);
      return;
    }
  }
  const write = getBridgeWrite();
  if (write) {
    try {
      const payload = meta === undefined ? { level, tag, message } : { level, tag, message, meta };
      write(payload);
      return;
    } catch {
      consoleFallback(level, tag, message, meta);
      return;
    }
  }
  consoleFallback(level, tag, message, meta);
}

export const logger: Logger = {
  debug: (tag, message, meta) => emit("debug", tag, message, meta),
  info: (tag, message, meta) => emit("info", tag, message, meta),
  warn: (tag, message, meta) => emit("warn", tag, message, meta),
  error: (tag, message, meta) => emit("error", tag, message, meta),
};
