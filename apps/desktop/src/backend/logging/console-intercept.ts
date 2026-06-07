/**
 * console-intercept.ts
 *
 * Patches `globalThis.console.{log,info,warn,error,debug}` so legacy call
 * sites flow through our Valo-style logger without a 700-call mechanical
 * migration. The original methods are stashed for two reasons:
 *   1. If a logger call itself throws (e.g. the singleton has not been
 *      initialized yet), we fall back to the original so the line is not
 *      silently lost.
 *   2. Uninstall must restore the exact prior refs — assigning a fresh
 *      `console` literal would clobber other patches and shadow real methods.
 *
 * Recursion safety: electron-log's node console transport snapshots
 * `console.error / warn / info / debug / log` at module load (see
 * `electron-log/src/node/transports/console.js`) and invokes those captured
 * references when writing — it does NOT call `globalThis.console.*` lazily.
 * As long as `electron-log` is `require`d before `installConsoleIntercept()`
 * runs, electron-log's console output cannot loop back through our patch.
 * The logger module imports electron-log at module load, so any caller that
 * imports the logger before installing the intercept satisfies that order.
 */

import { inspect } from "node:util";

import { logger } from "@/backend/logging/logger";

export interface InstallConsoleInterceptOpts {
  /** Tag to use for intercepted lines. Default `console`. */
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

// Module-level singleton — only one patch may be active at a time, and the
// FIRST returned uninstall must restore the originals (see the lifecycle test).
const state: PatchState = {
  installed: false,
  originals: {},
  uninstall: null,
};

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) {
    // Stacks already start with `Error: message` on V8, so this gives us the
    // most useful debugger-grep-friendly form when one is present.
    return arg.stack || arg.message || String(arg);
  }
  return inspect(arg, { depth: 3, breakLength: 120 });
}

function formatArgs(args: readonly unknown[]): string {
  if (args.length === 0) return "";
  if (args.length === 1 && typeof args[0] === "string") return args[0];
  return args.map(formatArg).join(" ");
}

export function installConsoleIntercept(opts: InstallConsoleInterceptOpts = {}): () => void {
  if (state.installed && state.uninstall) {
    // Idempotent: hand back the existing uninstall so callers that double-
    // install do not stack patches and a single uninstall still restores.
    return state.uninstall;
  }

  const tag = opts.tag ?? "console";
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
        // Logger failed (most often: not yet initialized). Fall back to the
        // original console so the message survives. We capture `original`
        // from the closure rather than re-reading `globalThis.console` to
        // avoid bouncing off our own patch.
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
