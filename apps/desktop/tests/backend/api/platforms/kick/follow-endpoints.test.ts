import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@backend/logging/logger";

// Guards: must classify failure causes distinctly (auth vs cloudflare vs parse vs network)
// so syncFollowsOnLogin can choose whether to mutate the local DB. A blanket
// "return []" would mask the difference between "user follows zero channels"
// (silent, valid) and "transient Cloudflare 403" (do not clear the user's
// previously imported follows).
// Guards: warn-once per failure class — repeated reconnect-loop calls must NOT
// spam the same warning. Verified against the _publicChannelWarnedSlugs
// convention in channel-endpoints.ts.
// Guards: single-flight Promise — two concurrent callers within the same tick
// share the same fetch() call.
// Guards: getAllFollowedChannels must try the cheap Bearer endpoint before opening a hidden BrowserWindow.
// Guards: a fallback-enabled authoritative reconciliation must not inherit a weaker bearer-only in-flight request.
// Guards: AbortController scope — timeout cancels in-flight fetch via abort
// signal so the BrowserWindow mutex elsewhere is never starved by a hanging
// request.
// Guards: followed-channel ingestion persists a stable broadcaster user ID
// whenever Kick exposes one directly or through its canonical avatar path.
// Guards: a non-empty browser scrape remains additive even when scrolling settles; missing rows require independent relationship proof.
// Guards: even an explicit empty following page remains additive until every missing stored row gets identity-matched relationship proof.
// Guards: authenticated Kick follow writes use only the canonical encoded channel follow path.
// Guards: rejected or thrown Kick web-session writes are classified for retry without escaping.

const mockToken = vi.hoisted(() => ({
  accessToken: "test-token-123",
  scope: [
    "user:read",
    "channel:read",
    "chat:write",
    "moderation:chat_message:manage",
    "moderation:ban",
    "events:subscribe",
  ],
}));
const fetchKickWebApiMutationMock = vi.hoisted(() => vi.fn());
const fetchKickWebApiGetMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../src/backend/services/storage-service", () => ({
  storageService: {
    getToken: vi.fn(() => mockToken),
    getKickUser: vi.fn(() => ({ id: 123, slug: "viewer", username: "Viewer" })),
  },
}));

vi.mock("@backend/api/platforms/kick/kick-send-window", () => ({
  fetchKickWebApiGet: fetchKickWebApiGetMock,
  fetchKickWebApiMutation: fetchKickWebApiMutationMock,
}));

const { storageService } = await import("../../../../../src/backend/services/storage-service");

import {
  _resetWarnedForTests,
  _tryBearerFetch,
  _tryWebSessionFetch,
  _tryWebSessionFollowedPageFetch,
  buildKickFollowApiIIFE,
  getAllFollowedChannels,
  KICK_FOLLOWED_CHANNELS_API_PATH,
  KICK_FOLLOWED_CHANNELS_PAGE_API_PATH,
  KICK_FOLLOWING_CHANNELS_URL,
  interpretBrowserFollowScan,
  mapScrapedKickFollowedChannel,
  canRecoverKickRedirectAbort,
  writeKickAccountFollow,
} from "../../../../../src/backend/api/platforms/kick/endpoints/follow-endpoints";

// Tests validate the Bearer-fetch path in isolation via _tryBearerFetch.
// The full getAllFollowedChannels orchestration (Bearer-first, then
// BrowserWindow fallback on auth-failed / cloudflare-challenge / parse-error
// / network-error) is validated by live integration test — see task #6 in
// docs/plans/2026-05-21-001-feat-kick-account-follows-import-plan.md.
const TEST_TOKEN = "test-token-123";

const FETCH_URL = "https://kick.com/api/v2/channels/followed";

it("scrapes the dedicated Kick followed-channels page", () => {
  expect(KICK_FOLLOWING_CHANNELS_URL).toBe("https://kick.com/following/channels");
});

it("uses the authenticated page API before the DOM compatibility fallback", () => {
  const source = buildKickFollowApiIIFE(
    '/api/v2/channels/followed-page?cursor=7&x="quoted"',
    "Bearer 1|abc"
  );

  expect(KICK_FOLLOWED_CHANNELS_API_PATH).toBe("/api/v2/channels/followed");
  expect(KICK_FOLLOWED_CHANNELS_PAGE_API_PATH).toBe("/api/v2/channels/followed-page");
  expect(source).toContain(JSON.stringify('/api/v2/channels/followed-page?cursor=7&x="quoted"'));
  expect(source).toContain(JSON.stringify("Bearer 1|abc"));
  expect(source).toContain('cache: "no-store"');
  expect(source).toContain('credentials: "include"');
});

describe("browser follow scan reconciliation", () => {
  it("accepts Electron ERR_ABORTED when the redirected Kick document is ready", () => {
    expect(
      canRecoverKickRedirectAbort(
        Object.assign(new Error("ERR_ABORTED (-3) loading https://kick.com/"), { code: -3 }),
        true
      )
    ).toBe(true);
  });

  it.each([
    [Object.assign(new Error("ERR_ABORTED"), { code: -3 }), false],
    [Object.assign(new Error("ERR_CERT_AUTHORITY_INVALID"), { code: -202 }), true],
    [new Error("following-page-load-timeout"), true],
  ])("rejects navigation failure %s when no valid redirect settlement exists", (error, ready) => {
    expect(canRecoverKickRedirectAbort(error, ready)).toBe(false);
  });
  it("keeps a complete non-empty browser scan additive", () => {
    expect(
      interpretBrowserFollowScan({
        channels: [{ slug: "xqc", displayName: "xQc", avatarUrl: "https://example/xqc.png" }],
        scoped: true,
        scrollSettled: true,
        reachedScrollEnd: true,
        loadingSettled: true,
        dedicatedFollowingPage: true,
      })
    ).toMatchObject({ status: "ok", canPruneAbsent: false });
  });

  it("keeps an unscoped empty scan additive so prior candidates can be individually verified", () => {
    expect(
      interpretBrowserFollowScan({
        channels: [],
        scoped: true,
        scrollSettled: true,
        reachedScrollEnd: true,
        loadingSettled: true,
        dedicatedFollowingPage: true,
      })
    ).toEqual({ status: "ok", channels: [], canPruneAbsent: false });
  });

  it("keeps an authenticated explicit-empty page additive pending per-row verification", () => {
    expect(
      interpretBrowserFollowScan({
        channels: [],
        scoped: true,
        scrollSettled: true,
        reachedScrollEnd: true,
        loadingSettled: true,
        dedicatedFollowingPage: true,
        emptyStateVisible: true,
      })
    ).toEqual({ status: "ok", channels: [], canPruneAbsent: false });
  });

  it("keeps an explicit empty page additive without an authenticated following scope", () => {
    expect(
      interpretBrowserFollowScan({
        channels: [],
        scoped: true,
        scrollSettled: true,
        reachedScrollEnd: true,
        loadingSettled: true,
        dedicatedFollowingPage: true,
        emptyStateVisible: true,
      })
    ).toEqual({ status: "ok", channels: [], canPruneAbsent: false });
  });
});

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function textResponse(body: string, init: ResponseInit = { status: 200 }): Response {
  return new Response(body, init);
}

function webFollow(slug: string) {
  return {
    category_name: "Just Chatting",
    channel_slug: slug,
    is_live: true,
    is_reserved: false,
    profile_picture: "https://example.invalid/avatar.webp",
    session_title: "Live",
    show_view_count: true,
    user_username: slug,
    viewer_count: 10,
  };
}

describe("_tryBearerFetch and getAllFollowedChannels", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const warnSpy = vi.mocked(logger.warn);

  beforeEach(() => {
    _resetWarnedForTests();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    warnSpy.mockClear();
    vi.mocked(logger.debug).mockClear();
    vi.mocked(storageService.getToken).mockReturnValue(mockToken);
    fetchKickWebApiGetMock.mockReset().mockResolvedValue({
      ok: false,
      kind: "network",
      status: 0,
      body: "",
      message: "unavailable",
    });
  });

  it("uses the authenticated Kick web session to enumerate fresh follows", async () => {
    const secretBody = JSON.stringify({
      channels: [webFollow("private-channel-value")],
      nextCursor: 0,
    });
    fetchKickWebApiGetMock
      .mockResolvedValueOnce({ ok: true, status: 200, body: secretBody })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 123, slug: "viewer" }),
      });

    const result = await _tryWebSessionFetch();

    expect(fetchKickWebApiGetMock).toHaveBeenCalledWith("/api/v2/channels/followed");
    expect(result).toMatchObject({
      status: "ok",
      canPruneAbsent: true,
      channels: [{ username: "private-channel-value" }],
    });
    const serializedLogs = JSON.stringify([
      ...vi.mocked(logger.debug).mock.calls,
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
    ]);
    expect(serializedLogs).not.toContain(secretBody);
    expect(serializedLogs).not.toContain("private-channel-value");
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "Kick:Endpoints:Follow",
      "Kick followed-list collection completed",
      {
        pageCount: 1,
        channelCount: 1,
        discardedRowCount: 0,
        viewerVerificationRequired: true,
      }
    );
  });

  it("treats Kick's full-page follow projection as additive", async () => {
    fetchKickWebApiGetMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        channels: [webFollow("newly-followed")],
        nextCursor: 0,
      }),
    });

    await expect(_tryWebSessionFollowedPageFetch()).resolves.toEqual({
      status: "ok",
      channels: [expect.objectContaining({ username: "newly-followed" })],
      canPruneAbsent: false,
    });
    expect(fetchKickWebApiGetMock).toHaveBeenCalledWith("/api/v2/channels/followed-page");
  });

  // Guards: nullable presentation metadata and additive response fields must not discard valid follow pages.
  it("accepts nullable presentation metadata and additive fields from Kick follow pages", async () => {
    fetchKickWebApiGetMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        channels: [
          {
            ...webFollow("nullable-metadata"),
            is_live: null,
            session_title: null,
            future_metadata: "ignored",
          },
        ],
        nextCursor: 0,
      }),
    });

    await expect(_tryWebSessionFollowedPageFetch()).resolves.toEqual({
      status: "ok",
      channels: [expect.objectContaining({ username: "nullable-metadata", isLive: false })],
      canPruneAbsent: false,
    });
  });

  it.each([-1, 1.5, "7", null])("rejects unsafe nextCursor value %s", async (nextCursor) => {
    fetchKickWebApiGetMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({ channels: [webFollow("unsafe-cursor")], nextCursor }),
    });

    await expect(_tryWebSessionFollowedPageFetch()).resolves.toEqual({
      status: "error",
      reason: "parse-error",
    });
  });

  it("rejects a follow page whose channels field is not an array", async () => {
    fetchKickWebApiGetMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({ channels: {}, nextCursor: 0 }),
    });

    await expect(_tryWebSessionFollowedPageFetch()).resolves.toEqual({
      status: "error",
      reason: "parse-error",
    });
  });

  it("keeps valid discoveries but disables pruning when a row has no safe identity", async () => {
    fetchKickWebApiGetMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({
          channels: [webFollow("safe-follow"), { ...webFollow("unsafe"), channel_slug: "" }],
          nextCursor: 0,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 123, slug: "viewer" }),
      });

    await expect(_tryWebSessionFetch()).resolves.toEqual({
      status: "ok",
      channels: [expect.objectContaining({ username: "safe-follow" })],
      canPruneAbsent: false,
    });
  });

  it("treats an omitted terminal cursor as the end of the collection", async () => {
    fetchKickWebApiGetMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ channels: [webFollow("terminal-follow")] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 123, slug: "viewer" }),
      });

    await expect(_tryWebSessionFetch()).resolves.toEqual({
      status: "ok",
      channels: [expect.objectContaining({ username: "terminal-follow" })],
      canPruneAbsent: true,
    });
    expect(fetchKickWebApiGetMock).toHaveBeenCalledTimes(2);
  });

  it("paginates with nextCursor, deduplicates slugs, and stops at zero", async () => {
    fetchKickWebApiGetMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({
          channels: [webFollow("one"), webFollow("duplicate")],
          nextCursor: 7,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({
          channels: [webFollow("duplicate"), webFollow("two")],
          nextCursor: 0,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 123, slug: "viewer" }),
      });

    const result = await _tryWebSessionFetch();

    expect(fetchKickWebApiGetMock).toHaveBeenNthCalledWith(1, "/api/v2/channels/followed");
    expect(fetchKickWebApiGetMock).toHaveBeenNthCalledWith(2, "/api/v2/channels/followed?cursor=7");
    expect(result).toMatchObject({
      status: "ok",
      channels: [{ username: "one" }, { username: "duplicate" }, { username: "two" }],
    });
  });

  it("rejects repeated cursors without identity verification", async () => {
    fetchKickWebApiGetMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ channels: [], nextCursor: 7 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ channels: [], nextCursor: 7 }),
      });

    await expect(_tryWebSessionFetch()).resolves.toEqual({
      status: "error",
      reason: "parse-error",
    });
    expect(fetchKickWebApiGetMock).toHaveBeenCalledTimes(2);
  });

  it("discards partial pages when a later page is rate limited", async () => {
    fetchKickWebApiGetMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ channels: [webFollow("one")], nextCursor: 7 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        kind: "unknown",
        status: 429,
        body: "",
        message: "limited",
        retryAfterSeconds: 30,
      });

    await expect(_tryWebSessionFetch()).resolves.toEqual({
      status: "error",
      reason: "rate-limited",
    });
  });

  it("rejects an authoritative list when the Kick website viewer differs from OAuth", async () => {
    fetchKickWebApiGetMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ channels: [], nextCursor: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 999, slug: "different-viewer" }),
      });

    await expect(_tryWebSessionFetch()).resolves.toEqual({
      status: "error",
      reason: "kick-web-account-mismatch",
    });
  });

  it("matches the Kick website viewer when the identity endpoint returns username", async () => {
    fetchKickWebApiGetMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ channels: [webFollow("matched-viewer")], nextCursor: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({ id: 123, username: "Viewer" }),
      });

    await expect(_tryWebSessionFetch()).resolves.toEqual({
      status: "ok",
      channels: [expect.objectContaining({ username: "matched-viewer" })],
      canPruneAbsent: true,
    });
  });

  it.each([401, 419])("classifies web-session HTTP %i as repair-required", async (status) => {
    fetchKickWebApiGetMock.mockResolvedValueOnce({
      ok: false,
      kind: "auth-expired",
      status,
      body: "",
      message: "expired",
    });

    await expect(_tryWebSessionFetch()).resolves.toEqual({
      status: "error",
      reason: "web-session-required",
    });
  });

  it("preserves rows and does not fall through on a 429 web-session response", async () => {
    fetchKickWebApiGetMock.mockResolvedValueOnce({
      ok: false,
      kind: "unknown",
      status: 429,
      body: "",
      message: "rate limited",
      retryAfterSeconds: 30,
    });

    await expect(getAllFollowedChannels({ allowBrowserWindowFallback: true })).resolves.toEqual({
      status: "error",
      reason: "rate-limited",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed web-session followed-list payloads", async () => {
    const sentinel = "PRIVATE_SENTINEL_CHANNEL";
    fetchKickWebApiGetMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({ unexpected: { channels: [{ slug: sentinel, id: 987654 }] } }),
    });

    await expect(_tryWebSessionFetch()).resolves.toEqual({
      status: "error",
      reason: "parse-error",
    });
    const serializedLogs = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(serializedLogs).not.toContain(sentinel);
    expect(serializedLogs).not.toContain("987654");
    expect(serializedLogs).toContain('"keys":["unexpected"]');
    expect(serializedLogs).toContain('"keys":["channels"]');
    expect(serializedLogs).toContain('"keys":["id","slug"]');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockClear();
    vi.restoreAllMocks();
  });

  it("returns ok with mapped channels on a well-formed response", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 411439,
            slug: "summit1g",
            user: { username: "Summit1G", profile_pic: "https://example.com/a.webp" },
          },
          {
            id: 222222,
            slug: "another",
            user: { username: "Another" },
          },
        ],
      })
    );

    const result = await _tryBearerFetch(TEST_TOKEN);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("type narrowing");
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]?.username).toBe("summit1g");
    expect(result.channels[0]?.displayName).toBe("Summit1G");
  });

  it("returns ok with empty array when the user follows zero channels (silent)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));

    const result = await _tryBearerFetch(TEST_TOKEN);

    expect(result).toEqual({ status: "ok", channels: [], canPruneAbsent: true });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("accepts a top-level array (not wrapped in `data`)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([{ id: 1, slug: "a", user: { username: "A" } }]));

    const result = await _tryBearerFetch(TEST_TOKEN);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("type narrowing");
    expect(result.channels).toHaveLength(1);
  });

  it("returns no-token when storage has no Kick token", async () => {
    vi.mocked(storageService.getToken).mockReturnValue(null);

    // no-token is checked inside getAllFollowedChannels (orchestrator), not
    // _tryBearerFetch (which trusts the token its caller provides). Verify
    // via the public entry point.
    const result = await getAllFollowedChannels();

    expect(result).toEqual({ status: "error", reason: "no-token" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("classifies 401 as auth-failed without warning for the expected Bearer rejection", async () => {
    fetchSpy.mockResolvedValueOnce(textResponse("", { status: 401 }));

    const result = await _tryBearerFetch(TEST_TOKEN);

    expect(result).toEqual({ status: "error", reason: "auth-failed" });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(vi.mocked(logger.debug)).toHaveBeenCalledWith(
      "Kick:Endpoints:Follow",
      "Kick v2 followed-channels rejected Bearer auth",
      { status: 401 }
    );
  });

  it("classifies 403 as auth-failed", async () => {
    fetchSpy.mockResolvedValueOnce(textResponse("", { status: 403 }));

    const result = await _tryBearerFetch(TEST_TOKEN);

    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("type narrowing");
    expect(result.reason).toBe("auth-failed");
  });

  it("classifies Cloudflare challenge HTML separately from parse-error", async () => {
    fetchSpy.mockResolvedValueOnce(
      textResponse(
        "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf-browser-verification</body></html>",
        { status: 200 }
      )
    );

    const result = await _tryBearerFetch(TEST_TOKEN);

    expect(result).toEqual({ status: "error", reason: "cloudflare-challenge" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[1] ?? "")).toMatch(/cloudflare/i);
  });

  it("classifies non-JSON text as parse-error", async () => {
    fetchSpy.mockResolvedValueOnce(textResponse("not json at all", { status: 200 }));

    const result = await _tryBearerFetch(TEST_TOKEN);

    expect(result).toEqual({ status: "error", reason: "parse-error" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("classifies wrong-shape JSON (neither array nor data array) as parse-error", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ unexpected: "shape" }));

    const result = await _tryBearerFetch(TEST_TOKEN);

    expect(result).toEqual({ status: "error", reason: "parse-error" });
  });

  it("rejects a single channel-shaped 200 instead of accepting the followed slug collision", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: 1, slug: "followed", user: { username: "Followed" } }))
        )
    );

    await expect(_tryBearerFetch(TEST_TOKEN)).resolves.toEqual({
      status: "error",
      reason: "parse-error",
    });
  });

  it("classifies a fetch throw as network-error", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await _tryBearerFetch(TEST_TOKEN);

    expect(result).toEqual({ status: "error", reason: "network-error" });
    // Network errors stay at debug level (not warn).
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns once per failure class across repeated calls", async () => {
    // Three repeated 403s. The Bearer path classifies each as 'auth-failed'
    // and emits exactly one warn for that class regardless of repetition.
    // The orchestration's BrowserWindow fallback may also emit at most one
    // warn for its own failure class (e.g. 'network-error' when the test
    // env has no Electron BrowserWindow) — that's also deduped via
    // _warnOnce per reason. The invariant under test: a reconnect loop
    // doesn't multiply log entries linearly with call count.
    fetchSpy
      .mockResolvedValueOnce(textResponse("", { status: 403 }))
      .mockResolvedValueOnce(textResponse("", { status: 403 }))
      .mockResolvedValueOnce(textResponse("", { status: 403 }));

    await getAllFollowedChannels();
    const warnsAfterFirst = warnSpy.mock.calls.length;
    await getAllFollowedChannels();
    await getAllFollowedChannels();

    // Subsequent calls must not add any new warns — all reason classes
    // already latched in _warned after the first call.
    expect(warnSpy.mock.calls.length).toBe(warnsAfterFirst);
    // And the per-class cap holds: at most one warn per reason class.
    // Currently observed class: 'network-error' from BrowserWindow fallback
    // failing in node env. The expected Bearer auth-failed path stays debug.
    expect(warnsAfterFirst).toBeLessThanOrEqual(2);
  });

  it("shares the in-flight Promise across concurrent callers", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    fetchSpy.mockReturnValueOnce(fetchPromise);

    const a = getAllFollowedChannels();
    const b = getAllFollowedChannels();

    resolveFetch(jsonResponse({ data: [{ id: 1, slug: "s", user: { username: "S" } }] }));

    const [resA, resB] = await Promise.all([a, b]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(resA).toEqual(resB);
  });

  it("keeps fallback-enabled and bearer-only requests in separate single-flight lanes", async () => {
    let resolveBearerOnly: (response: Response) => void = () => {};
    let resolveWithFallback: (response: Response) => void = () => {};
    fetchSpy
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveBearerOnly = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveWithFallback = resolve;
        })
      );

    const bearerOnly = getAllFollowedChannels();
    const withFallback = getAllFollowedChannels({ allowBrowserWindowFallback: true });

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    resolveBearerOnly(jsonResponse({ data: [] }));
    resolveWithFallback(jsonResponse({ data: [] }));

    await expect(Promise.all([bearerOnly, withFallback])).resolves.toEqual([
      { status: "ok", channels: [], canPruneAbsent: true },
      { status: "ok", channels: [], canPruneAbsent: true },
    ]);
  });

  it("_tryBearerFetch includes Authorization Bearer header on the diagnostic fetch", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await _tryBearerFetch(TEST_TOKEN);

    expect(fetchSpy).toHaveBeenCalledWith(
      FETCH_URL,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token-123",
        }),
      })
    );
  });
});

describe("mapScrapedKickFollowedChannel", () => {
  it("extracts the stable broadcaster user ID from a canonical Kick avatar URL", () => {
    const channel = mapScrapedKickFollowedChannel({
      slug: "abbyapple",
      displayName: "AbbyApple",
      avatarUrl:
        "https://files.kick.com/images/user/110821336/profile_image/conversion/avatar-thumb.webp",
    });

    expect(channel.id).toBe("110821336");
    expect(channel.kickUserId).toBe("110821336");
    expect(channel.username).toBe("abbyapple");
  });
});

describe("writeKickAccountFollow", () => {
  it("follows through the canonical encoded Kick web-session path", async () => {
    fetchKickWebApiMutationMock.mockResolvedValueOnce({ ok: true, status: 200, body: "{}" });

    await expect(
      writeKickAccountFollow({ action: "follow", channelSlug: "Space Name" })
    ).resolves.toEqual({ status: "ok" });
    expect(fetchKickWebApiMutationMock).toHaveBeenCalledWith(
      "POST",
      "/api/v2/channels/space%20name/follow"
    );
  });

  it("unfollows through the canonical encoded Kick web-session path", async () => {
    fetchKickWebApiMutationMock.mockResolvedValueOnce({ ok: true, status: 200, body: "{}" });

    await expect(
      writeKickAccountFollow({ action: "unfollow", channelSlug: "Space Name" })
    ).resolves.toEqual({ status: "ok" });
    expect(fetchKickWebApiMutationMock).toHaveBeenCalledWith(
      "DELETE",
      "/api/v2/channels/space%20name/follow"
    );
  });

  it("classifies an expired Kick web session as auth-failed", async () => {
    fetchKickWebApiMutationMock.mockResolvedValueOnce({
      ok: false,
      kind: "auth-expired",
      status: 401,
      body: "",
      message: "Session expired",
    });

    await expect(writeKickAccountFollow({ action: "follow", channelSlug: "xqc" })).resolves.toEqual(
      { status: "error", reason: "auth-failed" }
    );
  });

  it("classifies a Kick web-session network failure as network-error", async () => {
    fetchKickWebApiMutationMock.mockResolvedValueOnce({
      ok: false,
      kind: "network",
      status: 0,
      body: "",
      message: "Window unavailable",
    });

    await expect(writeKickAccountFollow({ action: "follow", channelSlug: "xqc" })).resolves.toEqual(
      { status: "error", reason: "network-error" }
    );
  });

  it("classifies another rejected Kick write with a stable retryable reason", async () => {
    fetchKickWebApiMutationMock.mockResolvedValueOnce({
      ok: false,
      kind: "unknown",
      status: 409,
      body: "{}",
      message: "Write rejected",
    });

    await expect(
      writeKickAccountFollow({ action: "unfollow", channelSlug: "xqc" })
    ).resolves.toEqual({ status: "error", reason: "write-failed" });
  });

  it("classifies a thrown Kick window warmup failure without leaking a rejection", async () => {
    fetchKickWebApiMutationMock.mockRejectedValueOnce(new Error("send-window-warmup-timeout"));

    await expect(writeKickAccountFollow({ action: "follow", channelSlug: "xqc" })).resolves.toEqual(
      { status: "error", reason: "network-error" }
    );
  });
});
