import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withTwitchHelixRetry } from "@/backend/api/platforms/twitch/helix-retry";

// Guards: `withTwitchHelixRetry` wraps any Helix call with a 401→refresh-token→retry-once pattern. The retry must not multiply (no double-refresh, no infinite loop), must surface a non-401 failure as-is, and must thread the refreshed token through `electronAPI.auth.getValidTwitchToken()` exactly once.

interface FakeWindow {
  electronAPI: {
    auth: {
      getValidTwitchToken: () => Promise<string | null>;
    };
  };
}

const originalWindow = (globalThis as { window?: FakeWindow }).window;

function installFakeWindow(getValidTwitchToken: () => Promise<string | null>): void {
  (globalThis as { window: FakeWindow }).window = {
    electronAPI: { auth: { getValidTwitchToken } },
  };
}

beforeEach(() => {
  (globalThis as { window?: FakeWindow }).window = undefined;
});

afterEach(() => {
  (globalThis as { window?: FakeWindow }).window = originalWindow;
  vi.restoreAllMocks();
});

describe("withTwitchHelixRetry", () => {
  it("returns the first result unchanged on success", async () => {
    installFakeWindow(async () => "fresh-never-called");
    const fn = vi.fn(async () => ({ ok: true as const, payload: 42 }));

    const result = await withTwitchHelixRetry({ accessToken: "old" }, fn);

    expect(result).toEqual({ ok: true, payload: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns the first failure unchanged when kind != unauthorized", async () => {
    installFakeWindow(async () => "fresh-never-called");
    const fn = vi.fn(async () => ({
      ok: false as const,
      kind: "forbidden",
      message: "nope",
    }));

    const result = await withTwitchHelixRetry({ accessToken: "old" }, fn);

    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once on unauthorized with the refreshed token", async () => {
    installFakeWindow(async () => "refreshed-token");
    const fn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, kind: "unauthorized", message: "expired" })
      .mockResolvedValueOnce({ ok: true, payload: "second-attempt-ok" });

    const result = await withTwitchHelixRetry(
      { accessToken: "old", broadcasterId: "1" },
      fn,
    );

    expect(result).toEqual({ ok: true, payload: "second-attempt-ok" });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, { accessToken: "old", broadcasterId: "1" });
    expect(fn).toHaveBeenNthCalledWith(2, {
      accessToken: "refreshed-token",
      broadcasterId: "1",
    });
  });

  it("does not retry when the refresh returns null (no usable token)", async () => {
    installFakeWindow(async () => null);
    const fn = vi.fn(async () => ({
      ok: false as const,
      kind: "unauthorized",
      message: "expired",
    }));

    const result = await withTwitchHelixRetry({ accessToken: "old" }, fn);

    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the refresh returns the same token (no rotation happened)", async () => {
    installFakeWindow(async () => "same-token");
    const fn = vi.fn(async () => ({
      ok: false as const,
      kind: "unauthorized",
      message: "expired",
    }));

    const result = await withTwitchHelixRetry({ accessToken: "same-token" }, fn);

    expect(result.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
