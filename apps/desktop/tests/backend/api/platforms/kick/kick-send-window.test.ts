import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const credentialMocks = vi.hoisted(() => ({
  saveKickWebBearer: vi.fn(),
  getKickWebBearer: vi.fn<() => string | null>(),
  clearKickWebBearer: vi.fn(),
}));

const electronSessionMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@backend/services/storage-service", () => ({
  storageService: credentialMocks,
}));

// Electron mock — replaced per-test as needed.
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  session: {
    defaultSession: {
      fetch: electronSessionMocks.fetch,
      cookies: {
        get: vi.fn(() =>
          Promise.resolve([
            { name: "session_token", session: false, expirationDate: 1_800_000_000 },
          ])
        ),
        set: vi.fn(() => Promise.resolve()),
        flushStore: vi.fn(() => Promise.resolve()),
      },
      webRequest: { onBeforeSendHeaders: vi.fn() },
    },
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
  isAllowedKickWebApiMutation,
  isKickWebApiReady,
  isSanctumBearer,
  parseKickChannelViewerRoleBody,
  releaseSendWindowComposerLeasesForOwner,
  releaseSendWindowForComposer,
  retainSendWindowForComposer,
  setBearerForTest,
  timeoutKickChatUser,
  type KickSendResult,
} from "@backend/api/platforms/kick/kick-send-window";
import { BrowserWindow, type Session } from "electron";

const BrowserWindowMock = vi.mocked(BrowserWindow);

beforeEach(async () => {
  const { session } = await import("electron");
  vi.mocked(session.defaultSession.cookies.get)
    .mockReset()
    .mockResolvedValue([
      {
        name: "session_token",
        value: "present",
        domain: ".kick.com",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "unspecified",
        session: false,
        expirationDate: 1_800_000_000,
      },
    ]);
  vi.mocked(session.defaultSession.cookies.set).mockReset().mockResolvedValue(undefined);
  vi.mocked(session.defaultSession.cookies.flushStore).mockReset().mockResolvedValue(undefined);
  credentialMocks.saveKickWebBearer.mockReset();
  credentialMocks.getKickWebBearer.mockReset().mockReturnValue(null);
  credentialMocks.clearKickWebBearer.mockReset();
  electronSessionMocks.fetch.mockReset().mockRejectedValue(new Error("direct session blocked"));
});

afterEach(() => {
  clearBearerForTest();
  vi.restoreAllMocks();
});

describe("module skeleton", () => {
  it("KickSendResult type accepts the ok=true variant", () => {
    const r: KickSendResult = { ok: true, messageId: "abc" };
    expect(r.ok).toBe(true);
  });

  it("KickSendResult models incomplete website setup separately from expired auth", () => {
    const r: KickSendResult = {
      ok: false,
      kind: "setup-required",
      message: "Kick chat authentication expired. Reconnect Kick in Settings.",
    };
    expect(r.kind).toBe("setup-required");
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
    const src = buildKickWebApiGetIIFE(`/api/v2/user/subscriptions?x="quoted"`, "Bearer 1|abc");

    expect(src).toContain(`method: "GET"`);
    expect(src).toContain(JSON.stringify(`/api/v2/user/subscriptions?x="quoted"`));
    expect(src).toContain(JSON.stringify("Bearer 1|abc"));
    expect(src).toContain(`"X-Requested-With"`);
    expect(src).toContain(`credentials: "include"`);
    expect(src).toContain(`cache: "no-store"`);
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
    listener: ((d: unknown, cb: (r: { requestHeaders: unknown }) => void) => void) | null;
    session: Session;
  } {
    let listener: ((d: unknown, cb: (r: { requestHeaders: unknown }) => void) => void) | null =
      null;
    const session = {
      webRequest: {
        onBeforeSendHeaders: vi.fn((_filter: unknown, l: typeof listener) => {
          listener = l;
        }),
      },
    };
    return {
      session: session as unknown as Session,
      get listener() {
        return listener;
      },
    };
  }

  it("captures a Sanctum bearer and updates the cache", () => {
    const fake = makeFakeSession();
    installBearerInterceptor(fake.session);
    const cb = vi.fn();
    fake.listener!(
      {
        requestHeaders: { Authorization: "Bearer 1|abc" },
        url: "https://kick.com/api/v2/anything",
      },
      cb
    );
    expect(getBearerForTest()).toBe("Bearer 1|abc");
    expect(cb).toHaveBeenCalledWith({ requestHeaders: { Authorization: "Bearer 1|abc" } });
  });

  it("captures a Sanctum bearer when Chromium lowercases the header name", () => {
    const fake = makeFakeSession();
    installBearerInterceptor(fake.session);
    const cb = vi.fn();

    fake.listener!(
      {
        requestHeaders: { authorization: "Bearer 1|lowercase" },
        url: "https://kick.com/api/v2/anything",
      },
      cb
    );

    expect(getBearerForTest()).toBe("Bearer 1|lowercase");
    expect(credentialMocks.saveKickWebBearer).toHaveBeenCalledWith("Bearer 1|lowercase");
  });

  it("ignores non-Sanctum Authorization values", () => {
    setBearerForTest("Bearer 1|previous");
    const fake = makeFakeSession();
    installBearerInterceptor(fake.session);
    const cb = vi.fn();
    fake.listener!(
      {
        requestHeaders: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.x.y" },
        url: "https://kick.com/api/v2/anything",
      },
      cb
    );
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
      expect.any(Function)
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
// Guards: a send with only Kick's anonymous session cookie reports setup-required without opening a window.
// Guards: a durable HttpOnly kick_session cookie can bootstrap hidden chat readiness without session_token.
// Guards: an anonymous Kick page that never emits a Sanctum bearer reports setup-required.
// Guards: authenticated hidden readiness renews and flushes the durable Kick website session.
// Guards: the persistent hidden Kick sender cannot autoplay audible channel media behind the muted player.
describe("ensureSendWindowReady", () => {
  it("restores the encrypted Sanctum bearer after a process restart", async () => {
    const setAudioMuted = vi.fn();
    credentialMocks.getKickWebBearer.mockReturnValue("Bearer 1|restored");
    const fakeWin = {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: {
        executeJavaScript: vi.fn(),
        on: vi.fn(),
        setAudioMuted,
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    BrowserWindowMock.mockImplementation(function (this: unknown) {
      return fakeWin;
    });

    await expect(ensureSendWindowReady("xqc")).resolves.toBeUndefined();

    expect(fakeWin.loadURL).toHaveBeenCalledWith("https://kick.com/xqc");
    expect(setAudioMuted).toHaveBeenCalledWith(true);
    expect(getBearerForTest()).toBe("Bearer 1|restored");
  });

  it("recovers and encrypts a Sanctum bearer from the durable session cookie", async () => {
    const { session } = await import("electron");
    vi.mocked(session.defaultSession.cookies.get).mockResolvedValue([
      {
        name: "session_token",
        value: "123|cookiebearer",
        domain: ".kick.com",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "unspecified",
        session: false,
        expirationDate: 1_900_000_000,
      },
    ]);
    const fakeWin = {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: {
        executeJavaScript: vi.fn(),
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    BrowserWindowMock.mockImplementation(function (this: unknown) {
      return fakeWin;
    });

    await expect(ensureSendWindowReady("vitaly")).resolves.toBeUndefined();

    expect(getBearerForTest()).toBe("Bearer 123|cookiebearer");
    expect(credentialMocks.saveKickWebBearer).toHaveBeenCalledWith("Bearer 123|cookiebearer");
    expect(fakeWin.loadURL).toHaveBeenCalledWith("https://kick.com/vitaly");
  });

  it("reports setup-required before constructing a hidden window for an anonymous session", async () => {
    const { BrowserWindow, session } = await import("electron");
    vi.mocked(session.defaultSession.cookies.get).mockResolvedValue([
      {
        name: "session_token",
        value: "anonymous",
        sameSite: "unspecified",
        session: true,
      },
    ]);
    vi.mocked(BrowserWindow).mockClear();

    await expect(ensureSendWindowReady()).rejects.toMatchObject({
      kind: "setup-required",
      userMessage: "Kick chat authentication expired. Reconnect Kick in Settings.",
    });

    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("returns typed setup-required from send without opening any window", async () => {
    const { BrowserWindow, session } = await import("electron");
    vi.mocked(session.defaultSession.cookies.get).mockResolvedValue([]);
    vi.mocked(BrowserWindow).mockClear();

    await expect(sendKickChatMessage(42, "hello")).resolves.toEqual({
      ok: false,
      kind: "setup-required",
      message: "Kick chat authentication expired. Reconnect Kick in Settings.",
    });
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("two concurrent calls share one warmup promise", async () => {
    const startedAt = Date.UTC(2026, 7, 20);
    const now = vi.spyOn(Date, "now").mockReturnValue(startedAt);
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
    const { BrowserWindow, session } = await import("electron");
    // vitest 4 requires `function` or `class` in mock impls for `new`
    // constructability — arrow functions throw "is not a constructor".
    BrowserWindowMock.mockImplementation(function (this: unknown) {
      acquired.push(1);
      // Simulate bearer capture happening during loadURL.
      setBearerForTest("Bearer 1|cap");
      return fakeWin;
    });

    const [a, b] = await Promise.all([ensureSendWindowReady(), ensureSendWindowReady()]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    expect(acquired.length).toBe(1);
    expect(await isKickWebApiReady()).toBe(true);
    expect(session.defaultSession.cookies.set).toHaveBeenCalled();
    expect(session.defaultSession.cookies.flushStore).toHaveBeenCalledOnce();

    now.mockReturnValue(startedAt + 24 * 60 * 60 * 1000 - 1);
    await ensureSendWindowReady();
    expect(session.defaultSession.cookies.flushStore).toHaveBeenCalledOnce();

    now.mockReturnValue(startedAt + 24 * 60 * 60 * 1000);
    await ensureSendWindowReady();
    expect(session.defaultSession.cookies.flushStore).toHaveBeenCalledTimes(2);

    fakeWin.webContents.executeJavaScript.mockResolvedValue(false);
    expect(await isKickWebApiReady()).toBe(true);
    expect(fakeWin.webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it("recreates a window destroyed during warmup", async () => {
    const destroyedWin = {
      loadURL: vi.fn(() => Promise.resolve()),
      webContents: {
        executeJavaScript: vi.fn(() => Promise.resolve(false)),
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => true),
    };
    const readyWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|recovered");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript: vi.fn(() => Promise.resolve(true)),
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    let constructionCount = 0;
    BrowserWindowMock.mockImplementation(function (this: unknown) {
      constructionCount += 1;
      return constructionCount === 1 ? destroyedWin : readyWin;
    });

    await expect(ensureSendWindowReady()).resolves.toBeUndefined();

    expect(constructionCount).toBe(2);
    expect(getBearerForTest()).toBe("Bearer 1|recovered");
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

    it("uses a durable HttpOnly kick_session cookie as bootstrap evidence", async () => {
      const { session } = await import("electron");
      vi.mocked(session.defaultSession.cookies.get).mockImplementation((filter) =>
        Promise.resolve(
          filter.name === "session_token"
            ? []
            : [
                {
                  name: "kick_session",
                  value: "redacted",
                  domain: ".kick.com",
                  path: "/",
                  secure: true,
                  sameSite: "unspecified",
                  httpOnly: true,
                  session: false,
                  expirationDate: 1_800_000_000,
                },
              ]
        )
      );
      const fakeWin = {
        loadURL: vi.fn(() => {
          setBearerForTest("Bearer 1|captured");
          return Promise.resolve();
        }),
        webContents: {
          executeJavaScript: vi.fn(() => Promise.resolve(false)),
          on: vi.fn(),
          session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
        },
        destroy: vi.fn(),
        isDestroyed: vi.fn(() => false),
      };
      BrowserWindowMock.mockImplementation(function (this: unknown) {
        return fakeWin;
      });

      await expect(ensureSendWindowReady()).resolves.toBeUndefined();
      expect(fakeWin.webContents.executeJavaScript).not.toHaveBeenCalled();
    });

    it("uses bearer capture as readiness without probing page-visible cookies", async () => {
      const fakeWin = {
        loadURL: vi.fn(() => {
          setBearerForTest("Bearer 1|captured");
          return Promise.resolve();
        }),
        webContents: {
          executeJavaScript: vi.fn(() => Promise.resolve(false)),
          on: vi.fn(),
          session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
        },
        destroy: vi.fn(),
        isDestroyed: vi.fn(() => false),
      };
      const { BrowserWindow } = await import("electron");
      BrowserWindowMock.mockImplementation(function (this: unknown) {
        return fakeWin;
      });

      const readiness = ensureSendWindowReady();
      readiness.catch(() => {});
      await vi.advanceTimersByTimeAsync(10_100);

      await expect(readiness).resolves.toBeUndefined();
      expect(fakeWin.webContents.executeJavaScript).not.toHaveBeenCalled();
    });

    it("retries once, then reports the secret-free readiness reason", async () => {
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
      let constructionCount = 0;
      BrowserWindowMock.mockImplementation(function (this: unknown) {
        constructionCount += 1;
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
      await vi.advanceTimersByTimeAsync(20_100);
      await expect(promise).rejects.toThrow(
        /send-window-warmup-timeout: timeout;.*attempt=2\/2 bearerCaptured=false windowDestroyed=false elapsedMs=10000/
      );
      expect(constructionCount).toBe(2);
    });

    it("returns setup-required when an anonymous page never emits a Sanctum bearer", async () => {
      const fakeWin = {
        loadURL: vi.fn(() => Promise.resolve()),
        webContents: {
          executeJavaScript: vi.fn(() => Promise.resolve(false)),
          on: vi.fn(),
          session: {
            cookies: {
              get: vi.fn(() => Promise.resolve([{ name: "session_token" }])),
            },
            webRequest: { onBeforeSendHeaders: vi.fn() },
          },
        },
        destroy: vi.fn(),
        isDestroyed: vi.fn(() => false),
      };
      const { BrowserWindow } = await import("electron");
      BrowserWindowMock.mockImplementation(function (this: unknown) {
        return fakeWin;
      });

      const send = sendKickChatMessage(1, "hello");
      send.catch(() => {});
      await vi.advanceTimersByTimeAsync(20_100);

      await expect(send).resolves.toEqual({
        ok: false,
        kind: "setup-required",
        message: "Kick chat authentication expired. Reconnect Kick in Settings.",
      });
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
        destroy: vi.fn(() => {
          destroyCalls.push(1);
        }),
        isDestroyed: vi.fn(() => false),
      };
      const { BrowserWindow } = await import("electron");
      (
        BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
      ).mockImplementation(function (this: unknown) {
        return fakeWin;
      } as unknown as () => unknown);

      const promise = ensureSendWindowReady();
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(20_100);
      await expect(promise).rejects.toThrow(/send-window-warmup-timeout/);
      // The window MUST have been destroyed during cleanup so it doesn't
      // leak and shadow a successor window's state.
      expect(destroyCalls.length).toBe(2);
      expect(getBearerForTest()).toBeNull();
    });
  });
});

import { sendKickChatMessage } from "@backend/api/platforms/kick/kick-send-window";

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
    BrowserWindowMock.mockImplementation(function (this: unknown) {
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
        })
      );
    });

    const result = await sendKickChatMessage(14161546, "hello", "xqc");
    expect(result).toEqual({ ok: true, messageId: "msg-123" });
    expect(fakeWin.loadURL).toHaveBeenCalledWith("https://kick.com/xqc");

    // The send IIFE was called with the chatroom id and bearer interpolated.
    const sendCalls = executeJavaScript.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("/api/v2/messages/send/14161546")
    );
    expect(sendCalls.length).toBe(1);
    expect(String(sendCalls[0][0])).toContain(`"Bearer 1|abc"`);
  });
});

describe("fetchKickWebApiGet", () => {
  // Guards: persisted Kick web credentials use Electron's cookie-bearing session directly before creating a renderer fallback.
  it("uses the direct authenticated session without constructing a hidden window", async () => {
    credentialMocks.getKickWebBearer.mockReturnValue("Bearer 1|persisted");
    electronSessionMocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ channel: { slug: "subbed" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    BrowserWindowMock.mockClear();

    const result = await fetchKickWebApiGet("/api/v2/user/subscriptions");

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: JSON.stringify({ data: [{ channel: { slug: "subbed" } }] }),
    });
    expect(electronSessionMocks.fetch).toHaveBeenCalledWith(
      "https://kick.com/api/v2/user/subscriptions",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ Authorization: "Bearer 1|persisted" }),
      })
    );
    expect(BrowserWindowMock).not.toHaveBeenCalled();
  });

  it("reuses an existing sender window when a direct read requires browser fallback", async () => {
    credentialMocks.getKickWebBearer.mockReturnValue("Bearer 1|persisted");
    electronSessionMocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthenticated." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })
    );
    const executeJavaScript = vi.fn().mockResolvedValue(
      JSON.stringify({
        ok: true,
        status: 200,
        body: JSON.stringify({ data: [] }),
        retryAfter: null,
      })
    );
    const fakeWin = {
      loadURL: vi.fn().mockResolvedValue(undefined),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    BrowserWindowMock.mockImplementation(function (this: unknown) {
      return fakeWin;
    });

    await ensureSendWindowReady();
    const result = await fetchKickWebApiGet("/api/v2/user/subscriptions");

    expect(result).toEqual({ ok: true, status: 200, body: JSON.stringify({ data: [] }) });
    expect(BrowserWindowMock).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded error when send-window navigation never settles", async () => {
    vi.useFakeTimers();
    const fakeWin = {
      loadURL: vi.fn(() => new Promise<void>(() => {})),
      webContents: {
        executeJavaScript: vi.fn(),
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

    const pending = fetchKickWebApiGet("/api/v2/channels/followed");
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toMatchObject({ ok: false, kind: "network", status: 0 });
    expect(fakeWin.destroy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  // Guards: raw moderation-state reads are not exposed through the generic hidden-window GET transport.
  it("rejects the unverified bare bans-list path", async () => {
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockClear: () => void }).mockClear();

    const result = await fetchKickWebApiGet("/api/v2/channels/xqc/bans");

    expect(result.ok).toBe(false);
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("rejects the unverified channel-user moderation path", async () => {
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockClear: () => void }).mockClear();

    const result = await fetchKickWebApiGet("/api/v2/channels/xqc/users/viewer");

    expect(result.ok).toBe(false);
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

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
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

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
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

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
  // Guards: guessed or recursively nested Kick role aliases never grant moderator authority.
  // Guards: unverifiable viewer-role lookups do not initialize the hidden Kick web window.
  it("fails closed for nested moderator aliases without a captured response contract", () => {
    expect(
      parseKickChannelViewerRoleBody(
        JSON.stringify({ data: { viewer: { is_moderator: true }, unrelated: { moderator: true } } })
      )
    ).toBeNull();
    expect(parseKickChannelViewerRoleBody(JSON.stringify({ data: { is_moderator: false } }))).toBe(
      null
    );
  });

  it("leaves guessed role arrays and unknown shapes unverifiable", () => {
    expect(
      parseKickChannelViewerRoleBody(JSON.stringify({ roles: ["subscriber", "moderator"] }))
    ).toBe(null);
    expect(
      parseKickChannelViewerRoleBody(JSON.stringify({ data: { following: true } }))
    ).toBeNull();
  });

  it("fails closed without warming the hidden window when authority is unverifiable", async () => {
    const executeJavaScript = vi.fn((src: string) => {
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
    (BrowserWindow as unknown as { mockClear: () => void }).mockClear();
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

    await expect(getKickChannelViewerRole("XQC")).resolves.toEqual({
      ok: true,
      isModerator: null,
      status: 0,
    });
    expect(BrowserWindow).not.toHaveBeenCalled();
  });

  it("does not compete with or dispose a concurrent required send warmup", async () => {
    const executeJavaScript = vi.fn((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/messages/send/1")) {
        return Promise.resolve(
          JSON.stringify({
            ok: true,
            status: 200,
            body: JSON.stringify({ data: { id: "sent" } }),
            retryAfter: null,
          })
        );
      }
      return Promise.resolve(true);
    });
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|captured");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    (BrowserWindow as unknown as { mockClear: () => void }).mockClear();
    BrowserWindowMock.mockImplementation(function (this: unknown) {
      return fakeWin;
    });

    const [role, send] = await Promise.all([
      getKickChannelViewerRole("xqc"),
      sendKickChatMessage(1, "hello"),
    ]);

    expect(role).toEqual({ ok: true, isModerator: null, status: 0 });
    expect(send).toEqual({ ok: true, messageId: "sent" });
    expect(BrowserWindow).toHaveBeenCalledTimes(1);
    expect(fakeWin.destroy).not.toHaveBeenCalled();
  });
});

// Guards: the hidden-window mutation allowlist admits exact Kick follow paths and rejects lookalikes.
describe("fetchKickWebApiMutation", () => {
  it("allows a canonical channel follow POST", () => {
    expect(isAllowedKickWebApiMutation("POST", "/api/v2/channels/space%20name/follow")).toBe(true);
  });

  it("allows a canonical channel unfollow DELETE", () => {
    expect(isAllowedKickWebApiMutation("DELETE", "/api/v2/channels/xqc/follow")).toBe(true);
  });

  it("rejects channel follow path lookalikes", () => {
    expect(isAllowedKickWebApiMutation("POST", "/api/v2/channels/xqc/follow/extra")).toBe(false);
    expect(isAllowedKickWebApiMutation("POST", "/api/v2/channels/xqc/follow?source=test")).toBe(
      false
    );
    expect(isAllowedKickWebApiMutation("DELETE", "/api/v2/channels//follow")).toBe(false);
  });

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
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

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
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

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
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

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
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

    let sendCallCount = 0;
    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/messages/send/")) {
        sendCallCount++;
        if (sendCallCount === 1) {
          return Promise.resolve(
            JSON.stringify({ ok: false, status: 401, body: "{}", retryAfter: null })
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
          })
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
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

    executeJavaScript.mockImplementation((src: string) => {
      if (src.includes("document.cookie")) return Promise.resolve(true);
      if (src.includes("/api/v2/messages/send/")) {
        return Promise.resolve(
          JSON.stringify({ ok: false, status: 401, body: "{}", retryAfter: null })
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
        on: vi.fn((evt: string, cb: (...args: unknown[]) => void) => {
          (handlers[evt] ||= []).push(cb);
        }),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy: vi.fn(),
      isDestroyed: vi.fn(() => false),
    };
    const { BrowserWindow } = await import("electron");
    let constructCount = 0;
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      constructCount++;
      setBearerForTest("Bearer 1|abc");
      return fakeWin;
    } as unknown as () => unknown);

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
        on: vi.fn((evt: string, cb: (...args: unknown[]) => void) => {
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
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return n++ === 0 ? win1 : win2;
    } as unknown as () => unknown);

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
    (
      BrowserWindow as unknown as { mockImplementation: (fn: () => unknown) => void }
    ).mockImplementation(function (this: unknown) {
      return fakeWin;
    } as unknown as () => unknown);

    await ensureSendWindowReady();
    await disposeSendWindow();

    expect(destroy).toHaveBeenCalled();
    expect(getBearerForTest()).toBeNull();
  });

  it("is a no-op when no window exists", async () => {
    await expect(disposeSendWindow()).resolves.toBeUndefined();
  });
});

describe("composer-owned idle reaping", () => {
  it("waits for the final composer lease before destroying the hidden window", async () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|abc");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript: vi.fn(() => Promise.resolve(true)),
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy,
      isDestroyed: vi.fn(() => false),
    };
    BrowserWindowMock.mockImplementation(function (this: unknown) {
      return fakeWin;
    });

    try {
      await ensureSendWindowReady();
      retainSendWindowForComposer(7, "first");
      retainSendWindowForComposer(7, "second");
      releaseSendWindowForComposer(7, "first");

      await vi.advanceTimersByTimeAsync(5_100);
      expect(destroy).not.toHaveBeenCalled();

      releaseSendWindowComposerLeasesForOwner(7);
      await vi.advanceTimersByTimeAsync(5_100);
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reap the window while a web mutation is still executing", async () => {
    vi.useFakeTimers();
    const destroy = vi.fn();
    let resolveMutation: ((value: string) => void) | undefined;
    const executeJavaScript = vi.fn((source: string) => {
      if (source.includes("/api/v2/channels/xqc/follow")) {
        return new Promise<string>((resolve) => {
          resolveMutation = resolve;
        });
      }
      return Promise.resolve(true);
    });
    const fakeWin = {
      loadURL: vi.fn(() => {
        setBearerForTest("Bearer 1|abc");
        return Promise.resolve();
      }),
      webContents: {
        executeJavaScript,
        on: vi.fn(),
        session: { webRequest: { onBeforeSendHeaders: vi.fn() } },
      },
      destroy,
      isDestroyed: vi.fn(() => false),
    };
    BrowserWindowMock.mockImplementation(function (this: unknown) {
      return fakeWin;
    });

    try {
      await ensureSendWindowReady();
      const mutation = fetchKickWebApiMutation("POST", "/api/v2/channels/xqc/follow");
      await vi.advanceTimersByTimeAsync(5_100);
      expect(destroy).not.toHaveBeenCalled();

      resolveMutation?.(JSON.stringify({ ok: true, status: 200, body: "{}" }));
      await expect(mutation).resolves.toEqual({ ok: true, status: 200, body: "{}" });
      await vi.advanceTimersByTimeAsync(5_100);
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
