import { describe, it, expect, vi } from "vitest";

import { waitForWebContentsCondition } from "@/backend/services/web-contents-ready";

function fakeWebContents(opts: {
  executeJavaScript: (code: string) => Promise<unknown>;
  isDestroyed?: () => boolean;
}) {
  return {
    executeJavaScript: vi.fn(opts.executeJavaScript),
    isDestroyed: vi.fn(opts.isDestroyed ?? (() => false)),
  };
}

describe("waitForWebContentsCondition", () => {
  it("resolves true as soon as the predicate is truthy", async () => {
    let calls = 0;
    const wc = fakeWebContents({
      executeJavaScript: async () => {
        calls += 1;
        return calls >= 3; // false, false, true
      },
    });
    const ready = await waitForWebContentsCondition(wc, "PRED", { timeoutMs: 100, intervalMs: 5 });
    expect(ready).toBe(true);
    expect(wc.executeJavaScript).toHaveBeenCalledWith("PRED");
  });

  it("resolves false when the predicate never becomes truthy before the timeout", async () => {
    const wc = fakeWebContents({ executeJavaScript: async () => false });
    const ready = await waitForWebContentsCondition(wc, "PRED", { timeoutMs: 40, intervalMs: 5 });
    expect(ready).toBe(false);
  });

  it("stops and resolves false if the webContents is destroyed mid-poll", async () => {
    let aliveChecks = 0;
    const wc = fakeWebContents({
      executeJavaScript: async () => false,
      isDestroyed: () => {
        aliveChecks += 1;
        return aliveChecks >= 2; // alive on first check, destroyed on second
      },
    });
    const ready = await waitForWebContentsCondition(wc, "PRED", { timeoutMs: 100, intervalMs: 5 });
    expect(ready).toBe(false);
    expect(wc.executeJavaScript).toHaveBeenCalledTimes(1); // no poll after destroy
  });

  it("swallows executeJavaScript rejections and keeps polling", async () => {
    let calls = 0;
    const wc = fakeWebContents({
      executeJavaScript: async () => {
        calls += 1;
        if (calls < 3) throw new Error("Cloudflare challenge");
        return true;
      },
    });
    const ready = await waitForWebContentsCondition(wc, "PRED", { timeoutMs: 100, intervalMs: 5 });
    expect(ready).toBe(true);
  });
});
