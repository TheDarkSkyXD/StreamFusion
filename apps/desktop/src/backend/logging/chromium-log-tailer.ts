/**
 * chromium-log-tailer.ts
 *
 * Tails a Chromium native log file (the path passed to `--log-file=...` when
 * `--enable-logging=file` is set) and forwards each new structured line into
 * the project logger under the "Chromium" tag.
 *
 * Why this exists: Chromium's native C++ code (e.g. `ssl_client_socket_impl`)
 * writes diagnostic lines DIRECTLY to OS file descriptors, bypassing Node's
 * stream layer. They show up in the dev terminal because electron-vite pipes
 * the child stderr, but `installNativeStderrIntercept` (which patches
 * `process.stderr.write`) never sees them. Routing Chromium's log to a file
 * we own and tailing it back into our session log closes that gap.
 *
 * Why a `setInterval` stat poll instead of `fs.watch` / `fs.watchFile`:
 * `fs.watch` misses append-only growth on several platforms. `fs.watchFile`
 * uses `uv_fs_poll`, which can sample the post-append size as its first
 * baseline and then never emit. Comparing each tick to our `readPosition`
 * still delivers those lines. One stat per second in production.
 *
 * No recursion guard needed: this tailer reads from disk and writes to a
 * DIFFERENT file (the main session log), so the logger's own write back to
 * disk cannot loop back through us.
 */

import fs from "node:fs";

import { isHarmlessChromiumNoise } from "@backend/logging/chromium-noise-filter";
import { logger } from "@backend/logging/logger";

export interface ChromiumLogTailerOpts {
  /** Absolute path of the file Chromium writes to. */
  filePath: string;
  /** Stat-poll interval (ms). Default 1000. */
  pollIntervalMs?: number;
}

// Same prefix the native-stderr-intercept parses: pid:date/time:LEVEL:src(line).
const CHROMIUM_PREFIX = /^\[\d+:\d+\/\d+\.\d+:(ERROR|WARNING|INFO|VERBOSE):/;

type ChromiumLevel = "ERROR" | "WARNING" | "INFO" | "VERBOSE";
type LoggerLevel = "debug" | "info" | "warn" | "error";

const LEVEL_MAP: Record<ChromiumLevel, LoggerLevel> = {
  ERROR: "error",
  WARNING: "warn",
  INFO: "info",
  VERBOSE: "debug",
};

function routeLine(line: string): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  const match = CHROMIUM_PREFIX.exec(trimmed);
  if (!match) {
    // Non-prefix lines are Chromium metadata (boot banners, config dumps,
    // continuation lines from multi-line dumps). They carry no diagnostic
    // signal and surfacing them at info would just noise the session log.
    // Drop silently.
    return;
  }
  let level = LEVEL_MAP[match[1] as ChromiumLevel];
  // Demote known-harmless GPU / DevTools probe noise to debug so it stops
  // pretending to be an actionable error in the session log.
  if (isHarmlessChromiumNoise(trimmed)) level = "debug";
  logger[level]("Chromium", trimmed);
}

interface TailerState {
  /** Bytes already forwarded so we only emit new appends. */
  readPosition: number;
  /** Carry-over for a line that didn't end with `\n` on the previous read. */
  carry: string;
  /** True until `stop()` clears the poller. */
  active: boolean;
}

/** Stop function returned from `startChromiumLogTailer`. Idempotent. */
export type StopChromiumLogTailer = () => void;

export function startChromiumLogTailer(opts: ChromiumLogTailerOpts): StopChromiumLogTailer {
  const { filePath } = opts;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;

  const state: TailerState = {
    readPosition: 0,
    carry: "",
    active: false,
  };

  // If the file already exists (Chromium started before us — true on resume),
  // start tailing from the END so we don't replay every line on relaunch.
  // If it doesn't exist yet, the next successful stat starts from byte 0.
  try {
    const stat = fs.statSync(filePath);
    state.readPosition = stat.size;
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }

  const onChange = (curr: fs.Stats): void => {
    if (curr.size < state.readPosition) {
      // File was truncated / rotated — reset and re-tail from the start.
      state.readPosition = 0;
      state.carry = "";
    }
    if (curr.size === state.readPosition) return;

    const bytesToRead = curr.size - state.readPosition;
    const buf = Buffer.alloc(bytesToRead);
    let fd: number | null = null;
    try {
      fd = fs.openSync(filePath, "r");
      fs.readSync(fd, buf, 0, bytesToRead, state.readPosition);
    } catch {
      // Disappeared between stat and read — try again on next tick.
      if (fd !== null) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore — file handle cleanup is best-effort.
        }
      }
      return;
    }
    try {
      fs.closeSync(fd);
    } catch {
      // Ignore — descriptor leak is bounded by process lifetime.
    }

    state.readPosition = curr.size;
    const text = state.carry + buf.toString("utf8");
    const lines = text.split("\n");
    // Last element may be a partial line (no trailing newline); keep it for
    // the next poll. If the file ended exactly on a newline, this is "".
    state.carry = lines.pop() ?? "";
    for (const line of lines) {
      routeLine(line);
    }
  };

  const poll = (): void => {
    try {
      onChange(fs.statSync(filePath));
    } catch {
      return;
    }
  };

  const timer = setInterval(poll, pollIntervalMs);
  state.active = true;

  return (): void => {
    if (!state.active) return;
    clearInterval(timer);
    state.active = false;
  };
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
