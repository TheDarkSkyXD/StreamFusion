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
  classifySendResult,
  clearBearerForTest,
  getBearerForTest,
  isSanctumBearer,
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

describe("classifySendResult", () => {
  it("200 with body.data.id returns ok+messageId", () => {
    const r = classifySendResult({
      status: 200,
      body: JSON.stringify({ data: { id: "01JAXK8N" } }),
      retryAfter: null,
    });
    expect(r).toEqual({ ok: true, messageId: "01JAXK8N" });
  });

  it("200 with body.data.message_id returns ok+messageId", () => {
    const r = classifySendResult({
      status: 200,
      body: JSON.stringify({ data: { message_id: "abc" } }),
      retryAfter: null,
    });
    expect(r).toEqual({ ok: true, messageId: "abc" });
  });

  it("201 with no id still returns ok+undefined", () => {
    const r = classifySendResult({ status: 201, body: "{}", retryAfter: null });
    expect(r).toEqual({ ok: true, messageId: undefined });
  });

  it("401 produces auth-expired", () => {
    const r = classifySendResult({ status: 401, body: "{}", retryAfter: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("auth-expired");
  });

  it("419 produces auth-expired", () => {
    const r = classifySendResult({ status: 419, body: "{}", retryAfter: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("auth-expired");
  });

  it("403 with 'User is not authenticated.' produces auth-expired", () => {
    const r = classifySendResult({
      status: 403,
      body: JSON.stringify({ message: "User is not authenticated." }),
      retryAfter: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("auth-expired");
  });

  it("403 with a different body produces forbidden", () => {
    const r = classifySendResult({
      status: 403,
      body: JSON.stringify({ message: "You are banned." }),
      retryAfter: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("forbidden");
  });

  it("429 with Retry-After parses to integer seconds", () => {
    const r = classifySendResult({
      status: 429,
      body: "{}",
      retryAfter: "12",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("rate-limited");
      expect(r.retryAfterSeconds).toBe(12);
    }
  });

  it("429 without Retry-After leaves retryAfterSeconds undefined", () => {
    const r = classifySendResult({ status: 429, body: "{}", retryAfter: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("rate-limited");
      expect(r.retryAfterSeconds).toBeUndefined();
    }
  });

  it("status:0 from the IIFE catch path produces network", () => {
    const r = classifySendResult({
      status: 0,
      body: "TypeError: fetch failed",
      retryAfter: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("network");
  });

  it("500 produces unknown with the status interpolated", () => {
    const r = classifySendResult({ status: 500, body: "{}", retryAfter: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe("unknown");
      expect(r.message).toContain("500");
    }
  });
});

describe("isSanctumBearer", () => {
  it("matches Sanctum id|secret format", () => {
    expect(isSanctumBearer("Bearer 369328786|PnWu1AkLBf6XzxexXX4Lo")).toBe(true);
  });
  it("rejects JWT-shaped bearers", () => {
    expect(isSanctumBearer("Bearer eyJhbGciOiJIUzI1NiJ9.abc.xyz")).toBe(false);
  });
  it("rejects empty values", () => {
    expect(isSanctumBearer("")).toBe(false);
    expect(isSanctumBearer("Bearer ")).toBe(false);
  });
  it("rejects bearers missing the numeric id", () => {
    expect(isSanctumBearer("Bearer |abc")).toBe(false);
  });
  it("rejects bearers missing the secret", () => {
    expect(isSanctumBearer("Bearer 1|")).toBe(false);
  });
});
