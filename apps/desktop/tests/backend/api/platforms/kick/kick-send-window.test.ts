import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Electron mock — replaced per-test as needed.
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  session: {
    defaultSession: {
      webRequest: { onBeforeSendHeaders: vi.fn() },
    },
  },
}));

import {
  clearBearerForTest,
  getBearerForTest,
  setBearerForTest,
  type KickSendResult,
} from "@/backend/api/platforms/kick/kick-send-window";

afterEach(() => {
  clearBearerForTest();
  vi.restoreAllMocks();
});

describe("module skeleton", () => {
  it("KickSendResult type accepts the ok=true variant", () => {
    const r: KickSendResult = { ok: true, messageId: "abc" };
    expect(r.ok).toBe(true);
  });

  it("bearer test hooks round-trip a value", () => {
    setBearerForTest("Bearer 1|abc");
    expect(getBearerForTest()).toBe("Bearer 1|abc");
    clearBearerForTest();
    expect(getBearerForTest()).toBeNull();
  });
});
