/**
 * Log IPC Bridge
 *
 * Renderer → main logging bridge plus three read-only invokes for the
 * Settings → Logs panel:
 *   - LOG_WRITE: fire-and-forget forward of a renderer log line to the
 *     main-process `logger` singleton. Sender-origin-checked because the
 *     main BrowserWindow runs with `webSecurity:false`, so any cross-origin
 *     content the renderer pulls in could otherwise spam the session log.
 *   - LOGS_OPEN_FOLDER: reveal the logs directory in the OS file explorer.
 *   - LOGS_GET_CURRENT_PATH: absolute path of the active session log.
 *   - LOGS_GET_NOISE_PATH: absolute path of the noise side-channel log, or
 *     null when the noise logger has not been initialized.
 *   - LOGS_TAIL: read the last N lines of either log file (clamped to [1,5000]).
 *
 * The renderer `tag` is namespaced with `Renderer:` before reaching the
 * logger so the on-disk format keeps main- and renderer-side messages
 * visually distinct.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { ipcMain, shell } from "electron";

import { IPC_CHANNELS } from "../../../shared/ipc-channels";
import { getCurrentLogPath, type LogLevel, logger } from "../../logging/logger";
import { getCurrentNoisePath } from "../../logging/noise-logger";
import { isAllowedSender } from "../sender-origin";

const VALID_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"] as const;
const MIN_TAIL = 1;
const MAX_TAIL = 5000;

interface LogWritePayload {
  level: unknown;
  tag: unknown;
  message: unknown;
  meta?: unknown;
}

interface LogsTailPayload {
  lines: unknown;
  file: unknown;
}

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (VALID_LEVELS as readonly string[]).includes(value);
}

function clampTailLines(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : MIN_TAIL;
  if (n < MIN_TAIL) return MIN_TAIL;
  if (n > MAX_TAIL) return MAX_TAIL;
  return n;
}

function safeNoisePath(): string | null {
  try {
    return getCurrentNoisePath();
  } catch {
    return null;
  }
}

async function readTail(filePath: string, lines: number): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const all = raw.split("\n");
  // Drop empty entries so a trailing newline does not surface as a blank row.
  const nonEmpty = all.filter((line) => line.length > 0);
  return nonEmpty.slice(-lines);
}

// One-shot at app startup, mirroring the convention of every other
// registerXxxHandlers function in this directory. A second call would stack
// duplicate listeners on the singleton ipcMain — don't do that.
export function registerLogHandlers(): void {
  ipcMain.on(IPC_CHANNELS.LOG_WRITE, (event, payload: LogWritePayload) => {
    if (!isAllowedSender(event)) {
      // Silent drop: a sender-origin warning here would itself be writable
      // by the disallowed caller (we'd be paying for their noise). The
      // sender-origin doc accepts that this class of failure is rare and
      // benign once the production main window is locked down.
      return;
    }
    const { level, tag, message, meta } = payload ?? ({} as LogWritePayload);
    if (!isLogLevel(level)) {
      logger.warn("LogIPC", "invalid level", {
        level,
        sender: event.senderFrame?.url ?? null,
      });
      return;
    }
    if (typeof tag !== "string" || typeof message !== "string") return;
    const safeMeta =
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)
        : undefined;
    logger[level](`Renderer:${tag}`, message, safeMeta);
  });

  ipcMain.handle(
    IPC_CHANNELS.LOGS_OPEN_FOLDER,
    async (): Promise<{
      ok: boolean;
      error?: string;
    }> => {
      try {
        const dir = path.dirname(getCurrentLogPath());
        const result = await shell.openPath(dir);
        // shell.openPath resolves with an empty string on success; a non-empty
        // string is Electron's documented error message.
        if (result === "") return { ok: true };
        return { ok: false, error: result };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.LOGS_GET_CURRENT_PATH, (): string => {
    return getCurrentLogPath();
  });

  ipcMain.handle(IPC_CHANNELS.LOGS_GET_NOISE_PATH, (): string | null => {
    return safeNoisePath();
  });

  ipcMain.handle(
    IPC_CHANNELS.LOGS_TAIL,
    async (_event, payload: LogsTailPayload): Promise<string[]> => {
      const lines = clampTailLines(payload?.lines);
      const file = payload?.file;
      if (file === "noise") {
        const noisePath = safeNoisePath();
        if (noisePath === null) return [];
        return readTail(noisePath, lines);
      }
      // Default to the main log for any other value (including 'main').
      return readTail(getCurrentLogPath(), lines);
    }
  );
}
