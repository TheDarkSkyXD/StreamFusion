/**
 * console-intercept.ts (renderer)
 *
 * Patches `globalThis.console.{log,info,warn,error,debug}` so legacy renderer
 * call sites flow through our IPC-backed logger without a mechanical migration.
 * Mirrors the main-process intercept but uses a different default tag
 * (`console:renderer`) so lines from the two processes are visually distinct
 * in the combined session file.
 *
 * Format strategy is intentionally simpler than main's:
 *   - The renderer cannot import `node:util.inspect` (process-boundary rule),
 *     so objects are serialized with `JSON.stringify` and a `String(arg)`
 *     fallback for circular references.
 *   - Errors keep their stack (or message) verbatim — debuggers grep that.
 *
 * Originals are stashed so a thrown logger call falls back to the captured
 * pre-patch method, and uninstall restores the exact prior refs (never a
 * fresh `console` literal that would clobber unrelated patches).
 */

import { logger } from "@/renderer/logging/logger";

export interface InstallConsoleInterceptOpts {
  /** Tag to use for intercepted lines. Default `console:renderer`. */
  tag?: string;
}

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";
type ConsoleFn = (...args: unknown[]) => void;
type LoggerLevel = "debug" | "info" | "warn" | "error";

const METHOD_TO_LEVEL: Record<ConsoleMethod, LoggerLevel> = {
  log: "info",
  info: "info",
  warn: "warn",
  error: "error",
  debug: "debug",
};

interface PatchState {
  installed: boolean;
  originals: Partial<Record<ConsoleMethod, ConsoleFn>>;
  uninstall: (() => void) | null;
}

const state: PatchState = {
  installed: false,
  originals: {},
  uninstall: null,
};

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) {
    return arg.stack || arg.message || String(arg);
  }
  if (arg === null || typeof arg !== "object") {
    return String(arg);
  }
  try {
    return JSON.stringify(arg);
  } catch {
    // Circular reference or other JSON failure — fall back to the JS default.
    return String(arg);
  }
}

function formatArgs(args: readonly unknown[]): string {
  if (args.length === 0) return "";
  if (args.length === 1 && typeof args[0] === "string") return args[0];
  return args.map(formatArg).join(" ");
}

export function installConsoleIntercept(opts: InstallConsoleInterceptOpts = {}): () => void {
  if (state.installed && state.uninstall) {
    return state.uninstall;
  }

  const tag = opts.tag ?? "console:renderer";
  const methods: ConsoleMethod[] = ["log", "info", "warn", "error", "debug"];
  const originals: Partial<Record<ConsoleMethod, ConsoleFn>> = {};

  for (const method of methods) {
    const original = globalThis.console[method] as ConsoleFn;
    originals[method] = original;
    const level = METHOD_TO_LEVEL[method];

    const patched: ConsoleFn = (...args: unknown[]) => {
      try {
        logger[level](tag, formatArgs(args));
      } catch {
        try {
          original.apply(globalThis.console, args);
        } catch {
          // The original threw too — there is nothing safe left to do.
        }
      }
    };

    (globalThis.console as unknown as Record<ConsoleMethod, ConsoleFn>)[method] = patched;
  }

  state.installed = true;
  state.originals = originals;

  const uninstall = (): void => {
    if (!state.installed) return;
    for (const method of methods) {
      const orig = originals[method];
      if (orig) {
        (globalThis.console as unknown as Record<ConsoleMethod, ConsoleFn>)[method] = orig;
      }
    }
    state.installed = false;
    state.originals = {};
    state.uninstall = null;
  };

  state.uninstall = uninstall;
  return uninstall;
}
