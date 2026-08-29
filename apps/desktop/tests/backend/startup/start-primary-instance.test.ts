import { describe, expect, it, vi } from "vitest";

import { startPrimaryInstance } from "@backend/startup/start-primary-instance";

describe("startPrimaryInstance", () => {
  it("exits a denied secondary instance without running startup", () => {
    const requestSingleInstanceLock = vi.fn(() => false);
    const exit = vi.fn();
    const once = vi.fn();
    const beforeReady = vi.fn();
    const ready = vi.fn();

    startPrimaryInstance({ requestSingleInstanceLock, exit, once }, { beforeReady, ready });

    expect(requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(once).not.toHaveBeenCalled();
    expect(beforeReady).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it("runs primary startup in the pre-ready and ready phases exactly once", async () => {
    const requestSingleInstanceLock = vi.fn(() => true);
    const exit = vi.fn();
    let readyListener: (() => void | Promise<void>) | undefined;
    const once = vi.fn((event: string, listener: () => void | Promise<void>) => {
      expect(event).toBe("ready");
      readyListener = listener;
    });
    const beforeReady = vi.fn();
    const ready = vi.fn();

    startPrimaryInstance({ requestSingleInstanceLock, exit, once }, { beforeReady, ready });

    expect(requestSingleInstanceLock).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    expect(beforeReady).toHaveBeenCalledOnce();
    expect(once).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();

    await readyListener?.();

    expect(ready).toHaveBeenCalledOnce();
  });
});
