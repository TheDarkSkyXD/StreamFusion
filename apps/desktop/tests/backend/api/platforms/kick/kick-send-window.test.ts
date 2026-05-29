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
  buildSendIIFE,
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

describe("buildSendIIFE", () => {
  it("interpolates chatroomId into the URL path via JSON.stringify", () => {
    const src = buildSendIIFE(14161546, "hello", "Bearer 1|abc");
    expect(src).toContain("/api/v2/messages/send/14161546");
  });

  it("neutralises quote injection via JSON.stringify on message content", () => {
    const evilContent = `";alert('xss');//`;
    const src = buildSendIIFE(1, evilContent, "Bearer 1|abc");
    // The safety property is that the content lives inside a JSON-quoted
    // string literal in the IIFE source — embedded double-quotes and
    // backslashes are escaped so the content cannot break out of the
    // string and execute. JSON.stringify is the escape mechanism; verify
    // the literal appears via that exact form. (The substring
    // `alert('xss')` will still occur inside the escaped string — that's
    // fine, it's inert text inside a JS string literal, not executable.)
    expect(src).toContain(JSON.stringify(evilContent));
  });

  it("sets the Authorization header to the supplied bearer", () => {
    const src = buildSendIIFE(1, "x", "Bearer 369328786|PnWu1AkL");
    expect(src).toContain(JSON.stringify("Bearer 369328786|PnWu1AkL"));
  });

  it("includes the kick.com web headers", () => {
    const src = buildSendIIFE(1, "x", "Bearer 1|a");
    expect(src).toContain('"X-App-Platform"');
    expect(src).toContain('"Referer"');
    expect(src).toContain('"Content-Type"');
    expect(src).toContain('"Accept"');
  });

  it("sets the body type to 'message' and supplies message_ref at run time", () => {
    const src = buildSendIIFE(1, "x", "Bearer 1|a");
    // The IIFE source uses object-literal syntax (unquoted key, space
    // after colon) — the JSON-stringified form `"type":"message"` only
    // appears after the IIFE runs at runtime, not in the source template
    // we inspect.
    expect(src).toMatch(/type:\s*"message"/);
    expect(src).toContain("message_ref");
    // message_ref is built INSIDE the IIFE via Date.now() — the source must
    // refer to Date.now(), not a baked-in timestamp.
    expect(src).toContain("Date.now()");
  });

  it("wraps the body in try/catch and returns a JSON string", () => {
    const src = buildSendIIFE(1, "x", "Bearer 1|a");
    expect(src).toContain("try");
    expect(src).toContain("catch");
    expect(src).toContain("JSON.stringify");
  });
});
