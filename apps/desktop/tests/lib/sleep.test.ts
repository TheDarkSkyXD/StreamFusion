import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sleep } from "@/lib/sleep";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("sleep", () => {
  it("resolves after the given delay", async () => {
    const onResolve = vi.fn();
    const p = sleep(1000).then(onResolve);
    await vi.advanceTimersByTimeAsync(999);
    expect(onResolve).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(onResolve).toHaveBeenCalledTimes(1);
  });
});
