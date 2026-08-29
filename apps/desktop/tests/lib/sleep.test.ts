import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCancellableSleep } from "@shared/utils/sleep";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Guards: cancellable sleeps settle with a discriminated completion outcome, physically dispose cancelled Node timers, and never keep Electron alive when explicitly unref'd.
describe("cancellable sleep", () => {
  it("settles successfully after the requested delay", async () => {
    const sleep = createCancellableSleep(250);

    await vi.advanceTimersByTimeAsync(250);

    await expect(sleep.result).resolves.toEqual({ ok: true });
  });

  it("settles with an explicit cancelled outcome instead of completing", async () => {
    const sleep = createCancellableSleep(250);

    expect(sleep.cancel()).toBe(true);
    await vi.advanceTimersByTimeAsync(250);

    await expect(sleep.result).resolves.toEqual({ ok: false, reason: "cancelled" });
  });

  it("makes repeated cancellation safe and reports only the first disposal", () => {
    const sleep = createCancellableSleep(250);

    expect(sleep.cancel()).toBe(true);
    expect(sleep.cancel()).toBe(false);
  });

  it("physically clears its pending timer when cancelled", () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const sleep = createCancellableSleep(250);

    sleep.cancel();

    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });

  it("unrefs the underlying Node timer when requested", () => {
    vi.useRealTimers();
    const unref = vi.fn();
    vi.stubGlobal("setTimeout", vi.fn(() => ({ unref })));

    const sleep = createCancellableSleep(250, { unref: true });

    expect(unref).toHaveBeenCalledOnce();
    sleep.cancel();
  });

  it("supports browser-like timers that have no unref method", () => {
    vi.useRealTimers();
    vi.stubGlobal("setTimeout", vi.fn(() => 42));

    const sleep = createCancellableSleep(250, { unref: true });

    expect(sleep.cancel()).toBe(true);
  });
});
