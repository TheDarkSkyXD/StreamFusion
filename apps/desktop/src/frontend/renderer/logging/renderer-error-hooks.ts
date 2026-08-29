/**
 * Renderer-side crash listeners — analogous to backend/logging/crash-hooks
 * but for the browser context.
 *
 * Listens to:
 *   - `window.addEventListener('error', ...)` — uncaught synchronous JS errors
 *     (including ones thrown from React render outside an error boundary that
 *     re-throw, and from event handlers / setTimeout callbacks).
 *   - `window.addEventListener('unhandledrejection', ...)` — promise
 *     rejections with no `.catch` handler.
 *
 * These two surfaces together catch every uncaught renderer error that would
 * otherwise only appear in DevTools. The console intercept catches
 * `console.error` calls but NOT thrown errors that no one logs explicitly.
 *
 * Output goes through the renderer logger (`window.electronAPI.logs.write`)
 * so the lines land in the same session log file with tag
 * `Renderer:Error` or `Renderer:UnhandledRejection`.
 */

import { logger } from "@/renderer/logging/logger";

interface SerializedError {
  name?: string;
  message?: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

interface InstallState {
  onError: (event: ErrorEvent) => void;
  onRejection: (event: PromiseRejectionEvent) => void;
}

let installed: InstallState | null = null;

function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  try {
    return { message: String(err) };
  } catch {
    return { message: "<unserializable error>" };
  }
}

function getWindow(): typeof window | undefined {
  return (globalThis as unknown as { window?: typeof window }).window;
}

export function installRendererErrorHooks(): () => void {
  if (installed) return uninstall;
  const w = getWindow();
  if (!w) return () => undefined;

  const onError = (event: ErrorEvent): void => {
    const meta: Record<string, unknown> = {
      ...serializeError(event.error ?? event.message),
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    };
    logger.error("Renderer:Error", event.message || "uncaught error", meta);
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    logger.error("Renderer:UnhandledRejection", "promise rejected without catch", {
      reason: serializeError(event.reason) as Record<string, unknown>,
    });
  };

  w.addEventListener("error", onError);
  w.addEventListener("unhandledrejection", onRejection);
  installed = { onError, onRejection };
  return uninstall;
}

function uninstall(): void {
  if (!installed) return;
  const w = getWindow();
  const state = installed;
  installed = null;
  if (!w) return;
  w.removeEventListener("error", state.onError);
  w.removeEventListener("unhandledrejection", state.onRejection);
}
