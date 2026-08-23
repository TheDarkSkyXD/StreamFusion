/**
 * Process- and app-level crash listeners that route every fatal event through
 * the structured logger so it lands in the session log file before the process
 * dies. The Electron `app` is injected so this module stays unit-testable
 * under plain Node without booting an Electron runtime.
 *
 * Listener refs are named (module-level functions, NOT anonymous closures)
 * because Node's EventEmitter only removes a listener when called with the
 * exact same function reference — `removeListener(name, () => ...)` would be
 * a silent no-op.
 */

import type { App } from "electron";

import { logger } from "@/backend/logging/logger";

export interface InstallOpts {
  /** Pass electron's `app` so this module stays unit-testable (DI). */
  app: App;
}

interface InstalledState {
  app: App;
  onUncaught: (err: Error) => void;
  onUnhandled: (reason: unknown) => void;
  onRenderGone: (
    event: unknown,
    webContents: unknown,
    details: { reason: string; exitCode: number }
  ) => void;
  onChildGone: (
    event: unknown,
    details: {
      type: string;
      reason: string;
      exitCode: number;
      serviceName?: string;
      name?: string;
    }
  ) => void;
}

let installed: InstalledState | null = null;

function serializeReason(reason: unknown): Record<string, unknown> {
  try {
    if (reason instanceof Error) {
      return { name: reason.name, message: reason.message, stack: reason.stack };
    }
    if (reason !== null && typeof reason === "object") {
      return reason as Record<string, unknown>;
    }
    return { reason: String(reason) };
  } catch {
    // A hostile reason (e.g. a Proxy whose property access throws) must NEVER
    // crash the host process while we're already handling a crash.
    try {
      return { reason: String(reason) };
    } catch {
      return { reason: "<unserializable>" };
    }
  }
}

export function installCrashHooks(opts: InstallOpts): () => void {
  if (installed !== null) {
    // Second install in the same process is a no-op; the first call's
    // uninstall closure stays valid.
    return () => undefined;
  }

  const onUncaught = (err: Error): void => {
    logger.error("CrashHooks", "uncaughtException", {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    // Process state is undefined after an uncaught exception. Electron's
    // synchronous exit avoids continuing with partially-mutated main state.
    if (typeof opts.app.exit === "function") opts.app.exit(1);
  };

  const onUnhandled = (reason: unknown): void => {
    logger.error("CrashHooks", "unhandledRejection", {
      reason: serializeReason(reason),
    });
  };

  const onRenderGone = (
    _event: unknown,
    _webContents: unknown,
    details: { reason: string; exitCode: number }
  ): void => {
    logger.error("CrashHooks", "render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
  };

  const onChildGone = (
    _event: unknown,
    details: {
      type: string;
      reason: string;
      exitCode: number;
      serviceName?: string;
      name?: string;
    }
  ): void => {
    logger.error("CrashHooks", "child-process-gone", {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name,
    });
  };

  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUnhandled);
  // The Electron `app.on` overloads are precisely typed per-event; our generic
  // handler shape doesn't match the union literally, hence the cast. The
  // runtime contract (event name + payload shape) is pinned by the tests.
  (opts.app as unknown as NodeJS.EventEmitter).on("render-process-gone", onRenderGone);
  (opts.app as unknown as NodeJS.EventEmitter).on("child-process-gone", onChildGone);

  installed = {
    app: opts.app,
    onUncaught,
    onUnhandled,
    onRenderGone,
    onChildGone,
  };

  return uninstall;
}

function uninstall(): void {
  if (installed === null) return;
  const state = installed;
  installed = null;

  process.removeListener("uncaughtException", state.onUncaught);
  process.removeListener("unhandledRejection", state.onUnhandled);
  (state.app as unknown as NodeJS.EventEmitter).removeListener(
    "render-process-gone",
    state.onRenderGone
  );
  (state.app as unknown as NodeJS.EventEmitter).removeListener(
    "child-process-gone",
    state.onChildGone
  );
}
