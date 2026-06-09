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
 *   - LOGS_GET_NETWORK_PATH: absolute path of the network side-channel log.
 *   - LOGS_TAIL: read the last N lines of any log file (clamped to [1,5000]).
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
import { getCurrentNetworkPath } from "../../logging/network-logger";
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
  level?: unknown;
  tag?: unknown;
  query?: unknown;
}

// Matches `[<iso>] [<level>] [<tag>] ...`. Mirrors the client-side
// `classifyLine` in LogsSection so what the user sees in the viewer always
// agrees with what server-side filters dropped.
const LINE_FORMAT = /^\[[^\]]+\]\s+\[(debug|info|warn|error)\]\s+\[([^\]]+)\]/i;

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

function safeNetworkPath(): string | null {
  try {
    return getCurrentNetworkPath();
  } catch {
    return null;
  }
}

interface ReadTailFilters {
  /** Restrict to this severity. `undefined` = all levels. */
  level?: LogLevel;
  /** Case-insensitive substring match against the tag. Empty/undefined = no filter. */
  tag?: string;
  /** Case-insensitive substring match against the whole line. Multiple values are OR'd. */
  query?: string[];
}

function normalizeQuery(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0)
    .slice(0, 25);
}

async function readTail(
  filePath: string,
  lines: number,
  filters: ReadTailFilters = {}
): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const all = raw.split("\n");
  // Drop empty entries so a trailing newline does not surface as a blank row.
  const nonEmpty = all.filter((line) => line.length > 0);

  const tagNeedle = filters.tag?.trim().toLowerCase() ?? "";
  const levelFilter = filters.level;
  const queryNeedles = filters.query ?? [];

  if (!levelFilter && tagNeedle === "" && queryNeedles.length === 0) {
    // Fast path: avoid the per-line regex scan when no filters are active.
    return nonEmpty.slice(-lines);
  }

  // Filter BEFORE the slice so a tag/level match deep in a big file isn't
  // dropped by a small `lines` window. Lines that don't match LINE_FORMAT
  // are treated as info + empty tag — matches the client's classifyLine.
  const filtered = nonEmpty.filter((line) => {
    const match = LINE_FORMAT.exec(line);
    const level = (match ? match[1].toLowerCase() : "info") as LogLevel;
    const tag = match ? match[2] : "";
    if (levelFilter && level !== levelFilter) return false;
    if (tagNeedle !== "" && !tag.toLowerCase().includes(tagNeedle)) return false;
    if (
      queryNeedles.length > 0 &&
      !queryNeedles.some((needle) => line.toLowerCase().includes(needle))
    ) {
      return false;
    }
    return true;
  });
  return filtered.slice(-lines);
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

  ipcMain.handle(IPC_CHANNELS.LOGS_GET_NETWORK_PATH, (): string | null => {
    return safeNetworkPath();
  });

  ipcMain.handle(
    IPC_CHANNELS.LOGS_TAIL,
    async (_event, payload: LogsTailPayload): Promise<string[]> => {
      const lines = clampTailLines(payload?.lines);
      const file = payload?.file;
      const filters: ReadTailFilters = {
        level: isLogLevel(payload?.level) ? payload.level : undefined,
        tag: typeof payload?.tag === "string" ? payload.tag : undefined,
        query: normalizeQuery(payload?.query),
      };
      if (file === "noise") {
        const noisePath = safeNoisePath();
        if (noisePath === null) return [];
        return readTail(noisePath, lines, filters);
      }
      if (file === "network") {
        const networkPath = safeNetworkPath();
        if (networkPath === null) return [];
        return readTail(networkPath, lines, filters);
      }
      // Default to the main log for any other value (including 'main').
      return readTail(getCurrentLogPath(), lines, filters);
    }
  );
}
