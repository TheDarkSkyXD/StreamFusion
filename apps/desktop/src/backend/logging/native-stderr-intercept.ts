/**
 * native-stderr-intercept.ts
 *
 * Patches `process.stderr.write` and `process.stdout.write` so lines emitted
 * directly by native Chromium / Electron internals — which bypass the JS
 * `console.*` intercept entirely — also land in our logger.
 *
 * Chromium emits structured lines like:
 *   `[26712:0607/155145.309:ERROR:CONSOLE(1)] "Request Autofill.enable..."`
 * The level (ERROR / WARNING / INFO / VERBOSE) is parsed out of that prefix
 * and routed to the matching logger method. Lines without the prefix fall
 * through to `logger.info(tag, line)` so output is never silently dropped.
 *
 * The original writers are always called first, so the line still shows up
 * in the terminal — we never suppress output, only mirror it.
 *
 * Recursion guard: electron-log's console transport writes back to
 * process.stderr / process.stdout when it flushes. A module-scope flag is
 * raised around the logger call so the nested write skips re-entry.
 */

import { logger } from "@/backend/logging/logger";

export interface InstallOpts {
  /** Default tag used when a chunk doesn't match Chromium's structured prefix. */
  tag?: string;
}

type WriteFn = typeof process.stderr.write;

interface PatchState {
  installed: boolean;
  uninstall: (() => void) | null;
}

const state: PatchState = {
  installed: false,
  uninstall: null,
};

// Recursion guard — raised while we're calling the logger so the logger's
// own write back to stderr/stdout (electron-log's console transport) does
// not re-enter the parsing path and loop forever.
let isWriting = false;

const CHROMIUM_PREFIX = /^\[\d+:\d+\/\d+\.\d+:(ERROR|WARNING|INFO|VERBOSE):/;

type ChromiumLevel = "ERROR" | "WARNING" | "INFO" | "VERBOSE";
type LoggerLevel = "debug" | "info" | "warn" | "error";

const LEVEL_MAP: Record<ChromiumLevel, LoggerLevel> = {
  ERROR: "error",
  WARNING: "warn",
  INFO: "info",
  VERBOSE: "debug",
};

function chunkToString(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
  return String(chunk);
}

function routeLine(line: string, tag: string): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  const match = CHROMIUM_PREFIX.exec(trimmed);
  if (match) {
    const level = LEVEL_MAP[match[1] as ChromiumLevel];
    logger[level]("Chromium", trimmed);
    return;
  }
  logger.info(tag, trimmed);
}

export function installNativeStderrIntercept(opts: InstallOpts = {}): () => void {
  if (state.installed && state.uninstall) {
    return state.uninstall;
  }

  const tag = opts.tag ?? "Chromium";

  // Closure-captured originals — stash the raw refs so uninstall can restore
  // the exact pre-install function identity. The patched closure binds at
  // call time so the original prototype is the receiver.
  const originalStderrWrite = process.stderr.write as WriteFn;
  const originalStdoutWrite = process.stdout.write as WriteFn;

  function patch(originalWrite: WriteFn, stream: NodeJS.WriteStream): WriteFn {
    const patched = function patchedWrite(this: unknown, ...args: unknown[]): boolean {
      // Always call the original first so the terminal still gets the line.
      // Cast through unknown — the original write signature is heavily
      // overloaded (string | Uint8Array, optional encoding, optional cb).
      const result = (originalWrite as unknown as (...a: unknown[]) => boolean).apply(stream, args);

      if (isWriting) return result;

      try {
        isWriting = true;
        const chunk = args[0];
        const text = chunkToString(chunk);
        if (text.length === 0) return result;
        const lines = text.split("\n");
        for (const line of lines) {
          routeLine(line, tag);
        }
      } catch {
        // Logger failure must not break stderr/stdout writes — they're the
        // last line of defense for diagnostics.
      } finally {
        isWriting = false;
      }

      return result;
    } as unknown as WriteFn;
    return patched;
  }

  process.stderr.write = patch(originalStderrWrite, process.stderr);
  process.stdout.write = patch(originalStdoutWrite, process.stdout);

  state.installed = true;

  const uninstall = (): void => {
    if (!state.installed) return;
    process.stderr.write = originalStderrWrite;
    process.stdout.write = originalStdoutWrite;
    state.installed = false;
    state.uninstall = null;
  };

  state.uninstall = uninstall;
  return uninstall;
}
