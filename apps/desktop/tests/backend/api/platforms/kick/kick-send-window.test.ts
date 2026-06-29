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

vi.mock("@/backend/auth/kick-auth", () => ({
  kickAuthService: {
    isAuthenticated: vi.fn(() => false),
    ensureValidToken: vi.fn(),
    getAccessToken: vi.fn(() => null),
  },
}));

import {
  buildKickWebApiMutationIIFE,
  buildKickWebApiGetIIFE,
  buildSendIIFE,
  classifySendResult,
  clearBearerForTest,
  disposeSendWindow,
  ensureSendWindowReady,
  fetchKickWebApiMutation,
  fetchKickWebApiGet,
  getKickChannelViewerRole,
  getBearerForTest,
  installBearerInterceptor,
  isSanctumBearer,
  parseKickChannelViewerRoleBody,
  setBearerForTest,
  timeoutKickChatUser,
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

describe("buildKickWebApiGetIIFE", () => {
  it("builds a credentialed GET with JSON-escaped path and bearer", () => {
    const src = buildKickWebApiGetIIFE(
      `/api/v2/user/subscriptions?x="quoted"`,
      "Bearer 1|abc"
    );

    expect(src).toContain(`method: "GET"`);
    expect(src).toContain(JSON.stringify(`/api/v2/user/subscriptions?x="quoted"`));
    expect(src).toContain(JSON.stringify("Bearer 1|abc"));
    expect(src).toContain(`"X-Requested-With"`);
    expect(src).toContain(`credentials: "include"`);
  });
});

describe("buildKickWebApiMutationIIFE", () => {
  it("builds a credentialed mutation with JSON-escaped path, bearer, and body", () => {
    const body = { message: { content: `quote " me` }, duration: 1200 };
    const src = buildKickWebApiMutationIIFE(
      "POST",
      "/api/v2/channels/ac7ionman/pinned-message",
      "Bearer 1|abc",
      body
    );

    expect(src).toContain(`method: "POST"`);
    expect(src).toContain(JSON.stringify("/api/v2/channels/ac7ionman/pinned-message"));
    expect(src).toContain(JSON.stringify("Bearer 1|abc"));
    expect(src).toContain(`credentials: "include"`);
    expect(src).toContain(`"X-Requested-With"`);
    expect(src).toContain(JSON.stringify(JSON.stringify(body)));
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

describe("installBearerInterceptor", () => {
  function makeFakeSession(): {
    listener: ((d: any, cb: (r: { requestHeaders: any }) => void) => void) | null;
    session: any;
  } {
    let listener: any = null;
    const session = {
      webRequest: {
        onBeforeSendHeaders: vi.fn((_filter: unknown, l: any) => {
          listener = l;
        }),
      },
    };
    return { session, get listener() { return listener; } };
  }

  it("captures a Sanctum bearer and updates the cache", () => {
    const fake = makeFakeSession();
    installBearerInterceptor(fake.session);
    const cb = vi.fn();
    fake.listener!({
      requestHeaders: { Authorization: "Bearer 1|abc" },
      url: "https://kick.com/api/v2/anything",
    }, cb);
    expect(getBearerForTest()).toBe("Bearer 1|abc");
    expect(cb).toHaveBeenCalledWith({ requestHeaders: { Authorization: "Bearer 1|abc" } });
  });

  it("ignores non-Sanctum Authorization values", () => {
    setBearerForTest("Bearer 1|previous");
    const fake = makeFakeSession();
    installBearerInterceptor(fake.session);
    const cb = vi.fn();
    fake.listener!({
      requestHeaders: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.x.y" },
      url: "https://kick.com/api/v2/anything",
    }, cb);
    expect(getBearerForTest()).toBe("Bearer 1|previous");
  });

  it("does not mutate requestHeaders", () => {
    const fake = makeFakeSession();
    installBearerInterceptor(fake.session);
    const cb = vi.fn();
    const headers = { Authorization: "Bearer 1|abc", "X-Other": "v" };
    fake.listener!({ requestHeaders: headers, url: "https://kick.com/" }, cb);
    expect(cb.mock.calls[0][0].requestHeaders).toBe(headers);
  });

  it("registers the filter with the *.kick.com URL pattern", () => {
    const fake = makeFakeSession();
    installBearerInterceptor(fake.session);
    expect(fake.session.webRequest.onBeforeSendHeaders).toHaveBeenCalledWith(
      { urls: ["https://*.kick.com/*"] },
      expect.any(Function),
    );
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

// Guards: ensureSendWindowReady — warmup deduplication (one promise across concurrent callers)
// and the warmup-timeout path (10s deadline → throws + destroys the leaked window so the next
// caller doesn't inherit a half-warmed window). The two warmup-timeout tests use fake timers
// (per U20.c speed-fix); WARMUP_TIMEOUT_MS is 10s in the source and the polling uses sleep()
// (setTimeout) inside _pollPredicate so vi.advanceTimersByTimeAsync drains the loop without
// burning real wall-clock.
describe("ensureSendWindowReady", () => {
  it("two concurrent calls share one warmup promise", async () => {
    const acquired: number[] = [];
    const fakeWin = {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: {
        // Predicate uses strict `=== true`; mock returns boolean true so the
        // warmup resolves on the first poll once the bearer is captured.
        executeJavaScript: vi.fn(() => Promise.resolve(true)),
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    // vitest 4 requires `function` or `class` in mock impls for `new`
    // constructability — arrow functions throw "is not a constructor".
    (BrowserWindow as any).mockImplementation(function (this: unknown) {
      acquired.push(1);
      // Simulate bearer capture happening during loadURL.
      setBearerForTest("Bearer 1|cap");
      return fakeWin;
    });

    const [a, b] = await Promise.all([ensureSendWindowReady(), ensureSendWindowReady()]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(acquired.length).toBe(1);
  });

  // Warmup-timeout tests share fake timers — production WARMUP_TIMEOUT_MS is 10s
  // with 200ms polling via sleep() (setTimeout). vi.advanceTimersByTimeAsync drains
  // the entire poll loop in ~ms instead of the real 10s wait. Previously these two
  // tests cost 20.3s wall-clock combined (per U20.c speed-fix); now ~ms each.
  describe("warmup-timeout (fake timers)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("rejects with send-window-warmup-timeout when predicate never resolves", async () => {
      const fakeWin = {
        loadURL: vi.fn(() => Promise.resolve()),
        webContents: {
          // Predicate returns false forever — never bearer-ready.
          executeJavaScript: vi.fn(() => Promise.resolve(false)),
          on: vi.fn(),
          session: {
            webRequest: { onBeforeSendHeaders: vi.fn() },
          },
        },
        destroy: vi.fn(),
        isDestroyed: vi.fn(() => false),
      };
      const { BrowserWindow } = await import("electron");
      (BrowserWindow as any).mockImplementation(function (this: unknown) {
        return fakeWin;
      });
      // Bearer cache stays null so even a cookie-true predicate wouldn't pass.
      const promise = ensureSendWindowReady();
      // Attach a no-op catch so the unhandled-rejection tracker stays quiet
      // while we drive the fake-timer loop; we still assert via the same
      // promise below.
      promise.catch(() => {});
      // Drain the 10s timeout's polling loop. Advance past the WARMUP_TIMEOUT_MS
      // deadline (10s) — the loop checks `Date.now() < deadline` each iteration
      // after a 200ms sleep, so once fake time is past 10s the loop throws.
      await vi.advanceTimersByTimeAsync(10_100);
      await expect(promise).rejects.toThrow(/send-window-warmup-timeout/);
    });

    it("destroys the leaked window on warmup failure (timeout)", async () => {
      const destroyCalls: Array<unknown> = [];
      const fakeWin = {
        loadURL: vi.fn(() => Promise.resolve()),
        webContents: {
          executeJavaScript: vi.fn(() => Promise.resolve(false)),
          on: vi.fn(),
          session: {
            webRequest: { onBeforeSendHeaders: vi.fn() },
          },
        },
        destroy: vi.fn(() => { destroyCalls.push(1); }),
        isDestroyed: vi.fn(() => false),
      };
      const { BrowserWindow } = await import("electron");
      (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
        function (this: unknown) {
          return fakeWin;
        } as unknown as () => unknown,
      );

      const promise = ensureSendWindowReady();
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(10_100);
      await expect(promise).rejects.toThrow(/send-window-warmup-timeout/);
      // The window MUST have been destroyed during cleanup so it doesn't
      // leak and shadow a successor window's state.
      expect(destroyCalls.length).toBe(1);
      expect(getBearerForTest()).toBeNull();
    });
  });
});

import { sendKickChatMessage } from "@/backend/api/platforms/kick/kick-send-window";

describe("sendKickChatMessage happy path", () => {
  it("returns ok+messageId on a 200 response with body.data.id", async () => {
    setBearerForTest("Bearer 1|abc");
    const executeJavaScript = vi.fn();
    const fakeWin = {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    // vitest 4 requires `function` or `class` in mock impls for `new`
    // constructability — arrow functions throw "is not a constructor".
    (BrowserWindow as any).mockImplementation(function (this: unknown) {
      setBearerForTest("Bearer 1|abc");
      return fakeWin;
    });

    // Warmup predicate calls (cookie check) return true, then the send IIFE
    // returns a 200 payload.
    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      return Promise.resolve(
        JSON.stringify({
          ok: true,
          status: 200,
          body: JSON.stringify({ data: { id: "msg-123" } }),
          retryAfter: null,
        }),
      );
    });

    await ensureSendWindowReady();
    const result = await sendKickChatMessage(14161546, "hello");
    expect(result).toEqual({ ok: true, messageId: "msg-123" });

    // The send IIFE was called with the chatroom id and bearer interpolated.
    const sendCalls = executeJavaScript.mock.calls.filter((c: any[]) =>
      String(c[0]).includes("/api/v2/messages/send/14161546"),
    );
    expect(sendCalls.length).toBe(1);
    expect(String(sendCalls[0][0])).toContain(`"Bearer 1|abc"`);
  });
});

describe("fetchKickWebApiGet", () => {
  it("rejects unsupported paths without initializing the hidden window", async () => {
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockClear: () => void }).mockClear();

    const result = await fetchKickWebApiGet("/api/v2/other");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unknown");
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("fires an allowed GET from the hidden Kick web session", async () => {
    const executeJavaScript = vi.fn();
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|abc");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown
    );

    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/user/subscriptions")) {
        return Promise.resolve(
          JSON.stringify({
            ok: true,
            status: 200,
            body: JSON.stringify({ data: [{ channel: { slug: "subbed" } }] }),
          })
        );
      }
      return Promise.resolve(true);
    });

    const result = await fetchKickWebApiGet("/api/v2/user/subscriptions");

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: JSON.stringify({ data: [{ channel: { slug: "subbed" } }] }),
    });
    const apiCalls = executeJavaScript.mock.calls.filter((call) =>
      String(call[0]).includes("/api/v2/user/subscriptions")
    );
    expect(apiCalls.length).toBe(1);
    expect(String(apiCalls[0][0])).toContain(`"Bearer 1|abc"`);
  });

  it("allows the channel viewer role GET path", async () => {
    const executeJavaScript = vi.fn();
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|abc");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown
    );

    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/channels/xqc/me")) {
        return Promise.resolve(
          JSON.stringify({
            ok: true,
            status: 200,
            body: JSON.stringify({ data: { is_moderator: true } }),
          })
        );
      }
      return Promise.resolve(true);
    });

    const result = await fetchKickWebApiGet("/api/v2/channels/xqc/me");

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: JSON.stringify({ data: { is_moderator: true } }),
    });
    const apiCalls = executeJavaScript.mock.calls.filter((call) =>
      String(call[0]).includes("/api/v2/channels/xqc/me")
    );
    expect(apiCalls.length).toBe(1);
  });
});

describe("getKickChannelViewerRole", () => {
  it("parses explicit moderator booleans", () => {
    expect(parseKickChannelViewerRoleBody(JSON.stringify({ data: { is_moderator: true } }))).toBe(
      true
    );
    expect(parseKickChannelViewerRoleBody(JSON.stringify({ data: { is_moderator: false } }))).toBe(
      false
    );
  });

  it("parses role arrays and leaves unknown shapes as null", () => {
    expect(parseKickChannelViewerRoleBody(JSON.stringify({ roles: ["subscriber", "moderator"] }))).toBe(
      true
    );
    expect(parseKickChannelViewerRoleBody(JSON.stringify({ data: { following: true } }))).toBeNull();
  });

  it("returns the parsed load-time viewer role", async () => {
    const executeJavaScript = vi.fn();
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|abc");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown
    );

    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/channels/xqc/me")) {
        return Promise.resolve(
          JSON.stringify({
            ok: true,
            status: 200,
            body: JSON.stringify({ data: { is_moderator: true } }),
          })
        );
      }
      return Promise.resolve(true);
    });

    await expect(getKickChannelViewerRole("XQC")).resolves.toEqual({
      ok: true,
      isModerator: true,
      status: 200,
    });
  });
});

describe("fetchKickWebApiMutation", () => {
  it("rejects unsupported mutations without initializing the hidden window", async () => {
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockClear: () => void }).mockClear();

    const result = await fetchKickWebApiMutation("POST", "/api/v2/other", {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unknown");
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("fires a pinned-message POST from the hidden Kick web session", async () => {
    const executeJavaScript = vi.fn();
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|abc");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown
    );

    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/channels/ac7ionman/pinned-message")) {
        return Promise.resolve(JSON.stringify({ ok: true, status: 200, body: "{}" }));
      }
      return Promise.resolve(true);
    });

    const result = await fetchKickWebApiMutation(
      "POST",
      "/api/v2/channels/ac7ionman/pinned-message",
      { duration: 1200 }
    );

    expect(result).toEqual({ ok: true, status: 200, body: "{}" });
    const apiCalls = executeJavaScript.mock.calls.filter((call) =>
      String(call[0]).includes("/api/v2/channels/ac7ionman/pinned-message")
    );
    expect(apiCalls.length).toBe(1);
    expect(String(apiCalls[0][0])).toContain(`"Bearer 1|abc"`);
    expect(String(apiCalls[0][0])).toContain(JSON.stringify(JSON.stringify({ duration: 1200 })));
  });

  it("fires a chatroom message DELETE from the hidden Kick web session", async () => {
    const executeJavaScript = vi.fn();
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|abc");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown
    );

    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (
        src.includes("/api/v2/chatrooms/14161546/messages/963b2976-8388-4975-b63a-32eb9c64f145")
      ) {
        return Promise.resolve(JSON.stringify({ ok: true, status: 204, body: "" }));
      }
      return Promise.resolve(true);
    });

    const result = await fetchKickWebApiMutation(
      "DELETE",
      "/api/v2/chatrooms/14161546/messages/963b2976-8388-4975-b63a-32eb9c64f145"
    );

    expect(result).toEqual({ ok: true, status: 204, body: "" });
    const apiCalls = executeJavaScript.mock.calls.filter((call) =>
      String(call[0]).includes(
        "/api/v2/chatrooms/14161546/messages/963b2976-8388-4975-b63a-32eb9c64f145"
      )
    );
    expect(apiCalls.length).toBe(1);
    expect(String(apiCalls[0][0])).toContain(`"Bearer 1|abc"`);
    expect(String(apiCalls[0][0])).toContain(`method: "DELETE"`);
  });

  it("fires a timeout POST from the hidden Kick web session", async () => {
    const executeJavaScript = vi.fn();
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|abc");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown
    );

    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/channels/anonsociety/bans")) {
        return Promise.resolve(JSON.stringify({ ok: true, status: 200, body: "{}" }));
      }
      return Promise.resolve(true);
    });

    const result = await timeoutKickChatUser("anonsociety", "baduser", 10);

    expect(result).toEqual({ ok: true, status: 200, body: "{}" });
    const apiCalls = executeJavaScript.mock.calls.filter((call) =>
      String(call[0]).includes("/api/v2/channels/anonsociety/bans")
    );
    expect(apiCalls.length).toBe(1);
    expect(String(apiCalls[0][0])).toContain(`"Bearer 1|abc"`);
    expect(String(apiCalls[0][0])).toContain(
      JSON.stringify(
        JSON.stringify({
          banned_username: "baduser",
          duration: 10,
          permanent: false,
        })
      )
    );
  });
});

describe("sendKickChatMessage auth-retry", () => {
  it("on 401, reloads the window and retries once", async () => {
    setBearerForTest("Bearer 1|stale");
    const executeJavaScript = vi.fn();
    // Tooling adaptation: paralleling the warmup test's pattern of setting
    // the bearer inside the BrowserWindow constructor mock, we set the
    // bearer inside loadURL so reload's _pollPredicate sees a fresh capture
    // (the real interceptor would do this on the post-reload kick.com
    // request — mocked out here).
    const loadURL = vi.fn(() => {
      setBearerForTest("Bearer 1|fresh");
      return Promise.resolve();
    });
    const fakeWin = {
      loadURL,
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown,
    );

    let sendCallCount = 0;
    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/messages/send/")) {
        sendCallCount++;
        if (sendCallCount === 1) {
          return Promise.resolve(
            JSON.stringify({ ok: false, status: 401, body: "{}", retryAfter: null }),
          );
        }
        // After reload, fresh bearer is captured.
        setBearerForTest("Bearer 1|fresh");
        return Promise.resolve(
          JSON.stringify({
            ok: true,
            status: 200,
            body: JSON.stringify({ data: { id: "msg-after-retry" } }),
            retryAfter: null,
          }),
        );
      }
      return Promise.resolve(true);
    });

    await ensureSendWindowReady();
    const result = await sendKickChatMessage(1, "hi");
    expect(result).toEqual({ ok: true, messageId: "msg-after-retry" });
    // Initial load + reload-on-401 = 2 loadURL calls.
    expect(loadURL.mock.calls.length).toBe(2);
    expect(sendCallCount).toBe(2);
  });

  it("if the retry also returns 401, surfaces auth-expired", async () => {
    setBearerForTest("Bearer 1|stale");
    const executeJavaScript = vi.fn();
    // Same tooling adaptation as above — set bearer during loadURL so the
    // reload's _pollPredicate resolves and we actually reach the retry path.
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|stale");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: {
          webRequest: { onBeforeSendHeaders: vi.fn() },
        },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown,
    );

    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/messages/send/")) {
        return Promise.resolve(
          JSON.stringify({ ok: false, status: 401, body: "{}", retryAfter: null }),
        );
      }
      return Promise.resolve(true);
    });

    await ensureSendWindowReady();
    const result = await sendKickChatMessage(1, "hi");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("auth-expired");
  });
});

describe("render-process-gone", () => {
  it("clears the bearer and forces a re-spawn on next send", async () => {
    setBearerForTest("Bearer 1|abc");
    const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const executeJavaScript = vi.fn(() => Promise.resolve(true));
    const fakeWin = {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: {
        executeJavaScript,
        on: vi.fn((evt: string, cb: any) => {
          (handlers[evt] ||= []).push(cb);
        }),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    let constructCount = 0;
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        constructCount++;
        setBearerForTest("Bearer 1|abc");
        return fakeWin;
      } as unknown as () => unknown,
    );

    await ensureSendWindowReady();
    expect(getBearerForTest()).toBe("Bearer 1|abc");

    // Simulate renderer crash.
    handlers["render-process-gone"]?.[0]?.({}, { reason: "crashed" });
    expect(getBearerForTest()).toBeNull();

    // Next ensure call should construct a fresh window.
    setBearerForTest("Bearer 1|fresh");
    await ensureSendWindowReady();
    expect(constructCount).toBe(2);
  });

  it("identity-guards the listener so a stale window does not clobber successor state", async () => {
    setBearerForTest("Bearer 1|first");
    const handlers1: Record<string, ((...args: unknown[]) => void)[]> = {};
    const win1 = {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: {
        executeJavaScript: vi.fn(() => Promise.resolve(true)),
        on: vi.fn((evt: string, cb: any) => {
          (handlers1[evt] ||= []).push(cb);
        }),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const win2 = {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: {
        executeJavaScript: vi.fn(() => Promise.resolve(true)),
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    let n = 0;
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return n++ === 0 ? win1 : win2;
      } as unknown as () => unknown,
    );

    await ensureSendWindowReady();
    // Option (a) adaptation: disposeSendWindow is still the Task 1 throwing
    // stub, so we substitute clearBearerForTest() which nulls sendWindow +
    // bearer + warmupPromise (per its existing Task 1 impl). This keeps
    // Task 9 independent of Task 10.
    clearBearerForTest();
    setBearerForTest("Bearer 1|second");
    await ensureSendWindowReady();
    expect(getBearerForTest()).toBe("Bearer 1|second");

    // Now fire win1's stale render-process-gone listener. Guard MUST prevent state clobber.
    handlers1["render-process-gone"]?.[0]?.({}, { reason: "crashed" });
    expect(getBearerForTest()).toBe("Bearer 1|second");
  });
});

describe("disposeSendWindow", () => {
  it("destroys the window and clears the bearer cache", async () => {
    setBearerForTest("Bearer 1|abc");
    const destroy = vi.fn();
    const executeJavaScript = vi.fn(() => Promise.resolve(true));
    const fakeWin = {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy,
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }).mockImplementation(
      function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown,
    );

    await ensureSendWindowReady();
    await disposeSendWindow();

    expect(destroy).toHaveBeenCalled();
    expect(getBearerForTest()).toBeNull();
  });

  it("is a no-op when no window exists", async () => {
    await expect(disposeSendWindow()).resolves.toBeUndefined();
  });
});
