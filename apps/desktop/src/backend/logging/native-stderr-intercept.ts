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
 * Structured Chromium lines are emitted through the logger only, so routine
 * levels stay file-only and errors use the logger's direct terminal path.
 * Unstructured process output passes through to the original writer unchanged.
 *
 * A module-scope recursion guard keeps any nested stream write triggered by a
 * logger sink from re-entering this parser.
 */

import { isHarmlessChromiumNoise } from "@backend/logging/chromium-noise-filter";
import { logger } from "@backend/logging/logger";

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

// Raised while calling the logger so a nested stream write from any sink does
// not re-enter the parsing path and loop forever.
let isWriting = false;

const CHROMIUM_PREFIX = /^\[\d+:\d+\/\d+\.\d+:(ERROR|WARNING|INFO|VERBOSE):/;
const STREAMFUSION_LOG_PREFIX =
  /^\[\d{4}-\d{2}-\d{2}T[^\]]+Z\] \[(debug|info|warn|error)\] \[[^\]]+\] /;

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
  if (STREAMFUSION_LOG_PREFIX.test(trimmed)) return;
  const match = CHROMIUM_PREFIX.exec(trimmed);
  if (match) {
    let level = LEVEL_MAP[match[1] as ChromiumLevel];
    // Demote known-harmless GPU / DevTools probe noise so it doesn't drown
    // real errors in the session log.
    if (isHarmlessChromiumNoise(trimmed)) level = "debug";
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
      const writeOriginal = (writeArgs: unknown[] = args): boolean =>
        (originalWrite as unknown as (...a: unknown[]) => boolean).apply(stream, writeArgs);

      if (isWriting) return writeOriginal();

      try {
        isWriting = true;
        const chunk = args[0];
        const text = chunkToString(chunk);
        if (text.length === 0) return writeOriginal();
        const segments = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
        for (const segment of segments) {
          routeLine(segment, tag);
        }
        const passThroughText = segments
          .filter((segment) => !CHROMIUM_PREFIX.test(segment.trim()))
          .join("");
        if (passThroughText === text) return writeOriginal();
        if (passThroughText.length > 0) {
          return writeOriginal([passThroughText, ...args.slice(1)]);
        }
      } catch {
        // Logger failure must not break stderr/stdout writes — they're the
        // last line of defense for diagnostics.
        return writeOriginal();
      } finally {
        isWriting = false;
      }

      return true;
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
