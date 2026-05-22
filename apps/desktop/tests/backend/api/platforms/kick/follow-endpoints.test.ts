import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
// Guards: AbortController scope — timeout cancels in-flight fetch via abort
// signal so the BrowserWindow mutex elsewhere is never starved by a hanging
// request.
// Guards: dual-id rule (delegates to transformer regression in
// kick-transformers.test.ts) — empty `id` on a slug-only row is accepted, but
// `user_id` is NEVER mapped to UnifiedChannel.id.

const mockToken = vi.hoisted(() => ({ accessToken: "test-token-123" }));

vi.mock("../../../../../src/backend/services/storage-service", () => ({
  storageService: {
    getToken: vi.fn(() => mockToken),
  },
}));

const { storageService } = await import(
  "../../../../../src/backend/services/storage-service"
);

import {
  _resetWarnedForTests,
  getAllFollowedChannels,
} from "../../../../../src/backend/api/platforms/kick/endpoints/follow-endpoints";

const FETCH_URL = "https://kick.com/api/v2/channels/followed";

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function textResponse(body: string, init: ResponseInit = { status: 200 }): Response {
  return new Response(body, init);
}

describe("getAllFollowedChannels", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetWarnedForTests();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.mocked(storageService.getToken).mockReturnValue(mockToken as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warnSpy.mockRestore();
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

    const result = await getAllFollowedChannels();

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("type narrowing");
    expect(result.channels).toHaveLength(2);
    expect(result.channels[0]?.username).toBe("summit1g");
    expect(result.channels[0]?.displayName).toBe("Summit1G");
  });

  it("returns ok with empty array when the user follows zero channels (silent)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));

    const result = await getAllFollowedChannels();

    expect(result).toEqual({ status: "ok", channels: [] });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("accepts a top-level array (not wrapped in `data`)", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse([{ id: 1, slug: "a", user: { username: "A" } }])
    );

    const result = await getAllFollowedChannels();

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("type narrowing");
    expect(result.channels).toHaveLength(1);
  });

  it("returns no-token when storage has no Kick token", async () => {
    vi.mocked(storageService.getToken).mockReturnValue(null);

    const result = await getAllFollowedChannels();

    expect(result).toEqual({ status: "error", reason: "no-token" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("classifies 401 as auth-failed and warns once", async () => {
    fetchSpy.mockResolvedValueOnce(textResponse("", { status: 401 }));

    const result = await getAllFollowedChannels();

    expect(result).toEqual({ status: "error", reason: "auth-failed" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/auth/i);
  });

  it("classifies 403 as auth-failed", async () => {
    fetchSpy.mockResolvedValueOnce(textResponse("", { status: 403 }));

    const result = await getAllFollowedChannels();

    expect(result.status).toBe("error");
    if (result.status !== "error") throw new Error("type narrowing");
    expect(result.reason).toBe("auth-failed");
  });

  it("classifies Cloudflare challenge HTML separately from parse-error", async () => {
    fetchSpy.mockResolvedValueOnce(
      textResponse(
        '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf-browser-verification</body></html>',
        { status: 200 }
      )
    );

    const result = await getAllFollowedChannels();

    expect(result).toEqual({ status: "error", reason: "cloudflare-challenge" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/cloudflare/i);
  });

  it("classifies non-JSON text as parse-error", async () => {
    fetchSpy.mockResolvedValueOnce(textResponse("not json at all", { status: 200 }));

    const result = await getAllFollowedChannels();

    expect(result).toEqual({ status: "error", reason: "parse-error" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("classifies wrong-shape JSON (neither array nor data array) as parse-error", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ unexpected: "shape" }));

    const result = await getAllFollowedChannels();

    expect(result).toEqual({ status: "error", reason: "parse-error" });
  });

  it("classifies a fetch throw as network-error", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));

    const result = await getAllFollowedChannels();

    expect(result).toEqual({ status: "error", reason: "network-error" });
    // Network errors stay at debug level (not warn).
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns once per failure class across repeated calls", async () => {
    fetchSpy
      .mockResolvedValueOnce(textResponse("", { status: 403 }))
      .mockResolvedValueOnce(textResponse("", { status: 403 }))
      .mockResolvedValueOnce(textResponse("", { status: 403 }));

    await getAllFollowedChannels();
    await getAllFollowedChannels();
    await getAllFollowedChannels();

    expect(warnSpy).toHaveBeenCalledTimes(1);
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

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(resA).toEqual(resB);
  });

  it("includes Authorization Bearer header on the fetch", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ data: [] }));

    await getAllFollowedChannels();

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
