/**
 * Guards renderer-side crash listeners that capture uncaught JS errors and
 * unhandled promise rejections — the renderer-context analogue of
 * backend/logging/crash-hooks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/renderer/logging/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from "@/renderer/logging/logger";
import { installRendererErrorHooks } from "@/renderer/logging/renderer-error-hooks";

describe("installRendererErrorHooks", () => {
  let uninstall: () => void;

  beforeEach(() => {
    vi.mocked(logger.error).mockReset();
  });

  afterEach(() => {
    if (uninstall) uninstall();
  });

  it("captures window 'error' events with name/message/stack/filename/lineno/colno", () => {
    uninstall = installRendererErrorHooks();
    const err = new TypeError("boom");
    const evt = new ErrorEvent("error", {
      error: err,
      message: "boom",
      filename: "renderer.tsx",
      lineno: 42,
      colno: 7,
    });
    window.dispatchEvent(evt);

    expect(logger.error).toHaveBeenCalledWith(
      "Renderer:Error",
      "boom",
      expect.objectContaining({
        name: "TypeError",
        message: "boom",
        filename: "renderer.tsx",
        lineno: 42,
        colno: 7,
      })
    );
  });

  it("captures 'unhandledrejection' with serialized Error reason", () => {
    uninstall = installRendererErrorHooks();
    const reason = new Error("rejected!");
    const promise = Promise.reject(reason);
    // Use a synthesized event so we don't actually fire an unhandled rejection
    // through the jsdom event loop (which would leak between tests).
    const evt = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(evt, "reason", { value: reason });
    Object.defineProperty(evt, "promise", { value: promise });
    window.dispatchEvent(evt);
    promise.catch(() => undefined);

    expect(logger.error).toHaveBeenCalledWith(
      "Renderer:UnhandledRejection",
      "promise rejected without catch",
      { reason: expect.objectContaining({ name: "Error", message: "rejected!" }) }
    );
  });

  it("serializes non-Error rejection reasons via String()", () => {
    uninstall = installRendererErrorHooks();
    const evt = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(evt, "reason", { value: "string reason" });
    Object.defineProperty(evt, "promise", { value: Promise.resolve() });
    window.dispatchEvent(evt);

    expect(logger.error).toHaveBeenCalledWith(
      "Renderer:UnhandledRejection",
      "promise rejected without catch",
      { reason: { message: "string reason" } }
    );
  });

  it("uninstall removes both listeners", () => {
    uninstall = installRendererErrorHooks();
    uninstall();
    // Install a sink listener so jsdom doesn't treat the dispatched error as
    // an unhandled-error test failure. The original hooks are gone, so the
    // logger mock must NOT be called.
    const sink = vi.fn();
    window.addEventListener("error", sink);
    const evt = new ErrorEvent("error", { error: new Error("x"), message: "x" });
    window.dispatchEvent(evt);
    expect(logger.error).not.toHaveBeenCalled();
    expect(sink).toHaveBeenCalled();
    window.removeEventListener("error", sink);
  });

  it("install is idempotent — second call does not double-register", () => {
    uninstall = installRendererErrorHooks();
    const second = installRendererErrorHooks();
    const evt = new ErrorEvent("error", { error: new Error("y"), message: "y" });
    window.dispatchEvent(evt);
    expect(logger.error).toHaveBeenCalledTimes(1);
    second();
  });
});
