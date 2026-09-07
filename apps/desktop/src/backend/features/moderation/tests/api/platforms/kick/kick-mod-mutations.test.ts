import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  banKickUserOfficial,
  setKickChatMode,
  timeoutKickUserOfficial,
  unbanKickUserOfficial,
} from "@backend/features/moderation/adapters/kick/kick-mod-mutations";

// Guards: Kick v2 moderation mutations â€” ban (permanent=true), timeout (permanent=false + duration), unban, delete-message, set-chat-mode. Each pins URL + method + body envelope so a casual refactor that "simplifies" the request shape doesn't silently 4xx mod actions.

let lastUrl: string | null = null;
let lastMethod: string | null = null;
let lastBody: unknown = null;
let lastHeaders: Record<string, string> | null = null;

interface NextResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

let nextResponse: NextResponse = { status: 200, body: { ok: true } };
let nextThrow: Error | null = null;

beforeEach(() => {
  lastUrl = null;
  lastMethod = null;
  lastBody = null;
  lastHeaders = null;
  nextResponse = { status: 200, body: { ok: true } };
  nextThrow = null;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (nextThrow) throw nextThrow;
    lastUrl = url;
    lastMethod = (init?.method as string) ?? "GET";
    lastHeaders = (init?.headers as Record<string, string>) ?? {};
    lastBody = init?.body ? JSON.parse(init.body as string) : null;
    const headers = new Headers(nextResponse.headers ?? {});
    return {
      ok: nextResponse.status >= 200 && nextResponse.status < 300,
      status: nextResponse.status,
      statusText: "",
      headers,
      json: async () => nextResponse.body ?? {},
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// URL + method + body construction
// ---------------------------------------------------------------------------

describe("timeoutKickUserOfficial", () => {
  it("never retries the undocumented Kick web endpoint when the official mutation fails", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        headers: new Headers(),
        json: async () => ({ message: "Official API unavailable" }),
      } as Response;
    });

    const result = await timeoutKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      duration: 10,
      accessToken: "tok-1",
    });

    expect(result.ok).toBe(false);
    expect(urls).toEqual(["https://api.kick.com/public/v1/moderation/bans"]);
  });
});

describe("official-only slash-command moderation", () => {
  it("preserves the ban reason without falling back to the web endpoint", async () => {
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      reason: "spam",
      accessToken: "tok-1",
    });

    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://api.kick.com/public/v1/moderation/bans");
    expect(lastBody).toEqual({ broadcaster_user_id: 123, user_id: 456, reason: "spam" });
  });

  it("unbans through the official endpoint", async () => {
    const result = await unbanKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });

    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe("https://api.kick.com/public/v1/moderation/bans");
    expect(lastBody).toEqual({ broadcaster_user_id: 123, user_id: 456 });
  });

  it("rejects invalid user IDs before making a request", async () => {
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 0,
      accessToken: "tok-1",
    });

    expect(result).toEqual({
      ok: false,
      kind: "unknown",
      message: "Invalid official Kick moderation input.",
    });
    expect(lastUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setKickChatMode â€” one test per mode key + a combined test
// ---------------------------------------------------------------------------

describe("setKickChatMode", () => {
  it("POSTs to /api/v2/channels/{slug}/chatroom â€” slow mode on", async () => {
    const result = await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { slowMode: { enabled: true, seconds: 30 } },
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://kick.com/api/v2/channels/ac7ionman/chatroom");
    expect(lastBody).toEqual({
      slow_mode: { enabled: true, message_interval: 30 },
    });
  });

  it("slow mode off â†’ { slow_mode: { enabled: false, message_interval: 0 } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { slowMode: { enabled: false } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({
      slow_mode: { enabled: false, message_interval: 0 },
    });
  });

  it("followers-only on â†’ { followers_mode: { enabled: true, min_duration: N } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { followersOnly: { enabled: true, minutes: 120 } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({
      followers_mode: { enabled: true, min_duration: 120 },
    });
  });

  it("followers-only off â†’ { followers_mode: { enabled: false, min_duration: 0 } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { followersOnly: { enabled: false } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({
      followers_mode: { enabled: false, min_duration: 0 },
    });
  });

  it("subscribers-only on â†’ { subscribers_mode: { enabled: true } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { subscribersOnly: { enabled: true } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({ subscribers_mode: { enabled: true } });
  });

  it("subscribers-only off â†’ { subscribers_mode: { enabled: false } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { subscribersOnly: { enabled: false } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({ subscribers_mode: { enabled: false } });
  });

  it("emote-only on â†’ { emotes_mode: { enabled: true } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { emoteOnly: { enabled: true } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({ emotes_mode: { enabled: true } });
  });

  it("emote-only off â†’ { emotes_mode: { enabled: false } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { emoteOnly: { enabled: false } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({ emotes_mode: { enabled: false } });
  });

  it("combines multiple mode keys in a single POST body", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: {
        slowMode: { enabled: true, seconds: 10 },
        followersOnly: { enabled: true, minutes: 60 },
        subscribersOnly: { enabled: false },
        emoteOnly: { enabled: true },
      },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({
      slow_mode: { enabled: true, message_interval: 10 },
      followers_mode: { enabled: true, min_duration: 60 },
      subscribers_mode: { enabled: false },
      emotes_mode: { enabled: true },
    });
  });
});

// ---------------------------------------------------------------------------
// Classification (representative function: banKickUser)
// ---------------------------------------------------------------------------

describe("banKickUserOfficial classification", () => {
  it("401 â†’ unauthenticated", async () => {
    nextResponse = { status: 401, body: { message: "Unauthorized" } };
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unauthenticated");
  });

  it("403 â†’ forbidden", async () => {
    nextResponse = { status: 403, body: { message: "Forbidden" } };
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    if (!result.ok) expect(result.kind).toBe("forbidden");
    else throw new Error("expected forbidden");
  });

  it("404 â†’ not-found", async () => {
    nextResponse = { status: 404, body: { message: "Not Found" } };
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    if (!result.ok) expect(result.kind).toBe("not-found");
    else throw new Error("expected not-found");
  });

  it("429 with Retry-After: 30 â†’ rate-limited, retryAfterSeconds=30", async () => {
    nextResponse = {
      status: 429,
      body: { message: "slow down" },
      headers: { "Retry-After": "30" },
    };
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    if (result.ok || result.kind !== "rate-limited") {
      throw new Error("expected rate-limited");
    }
    expect(result.retryAfterSeconds).toBe(30);
  });

  it("429 without Retry-After â†’ retryAfterSeconds=null", async () => {
    nextResponse = { status: 429, body: { message: "slow down" } };
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    if (result.ok || result.kind !== "rate-limited") {
      throw new Error("expected rate-limited");
    }
    expect(result.retryAfterSeconds).toBeNull();
  });

  it("500 â†’ network", async () => {
    nextResponse = { status: 500, body: { message: "boom" } };
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    if (!result.ok) expect(result.kind).toBe("network");
    else throw new Error("expected network");
  });

  it("fetch throws â†’ { ok: false, kind: 'network' }", async () => {
    nextThrow = new Error("ECONNREFUSED");
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    if (!result.ok) {
      expect(result.kind).toBe("network");
      expect(result.message).toBe("ECONNREFUSED");
    } else {
      throw new Error("expected network");
    }
  });
});

// ---------------------------------------------------------------------------
// Classifier substring-hint behavior
// ---------------------------------------------------------------------------

describe("classifier substring hints", () => {
  it("200 with body { message: 'Permission denied' } still returns ok: true", async () => {
    nextResponse = { status: 200, body: { message: "Permission denied" } };
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
  });

  it("400 with body containing 'forbidden' classifies as 'forbidden'", async () => {
    nextResponse = {
      status: 400,
      body: { message: "Action forbidden for this user" },
    };
    const result = await banKickUserOfficial({
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    if (!result.ok) expect(result.kind).toBe("forbidden");
    else throw new Error("expected forbidden");
  });
});

const officialActions = [
  {
    name: "ban",
    method: "POST",
    body: { broadcaster_user_id: 123, user_id: 456, reason: "spam" },
    run: () =>
      banKickUserOfficial({
        broadcasterUserId: 123,
        userId: 456,
        accessToken: "tok-1",
        reason: "spam",
      }),
  },
  {
    name: "timeout",
    method: "POST",
    body: { broadcaster_user_id: 123, user_id: 456, duration: 10, reason: "spam" },
    run: () =>
      timeoutKickUserOfficial({
        broadcasterUserId: 123,
        userId: 456,
        accessToken: "tok-1",
        duration: 10,
        reason: "spam",
      }),
  },
  {
    name: "unban",
    method: "DELETE",
    body: { broadcaster_user_id: 123, user_id: 456 },
    run: () => unbanKickUserOfficial({ broadcasterUserId: 123, userId: 456, accessToken: "tok-1" }),
  },
];

describe.each(officialActions)("official $name request ownership", ({ run, method, body }) => {
  it("sends one authenticated request with the exact official payload on success", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: {}, message: "OK" }), { status: 200 })
      );
    vi.stubGlobal("fetch", request);
    expect(await run()).toEqual({ ok: true });
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "https://api.kick.com/public/v1/moderation/bans",
      {
        method,
        headers: {
          Authorization: "Bearer tok-1",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: expect.any(AbortSignal),
      }
    );
  });

  it.each([
    { status: 401, kind: "unauthenticated" },
    { status: 403, kind: "forbidden" },
    { status: 404, kind: "not-found" },
    { status: 429, kind: "rate-limited" },
    { status: 500, kind: "network" },
  ])("preserves $status failure without a second write", async ({ status, kind }) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "rejected" }), {
          status,
          headers: { "Retry-After": "30" },
        })
      )
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);
    expect(await run()).toEqual({
      ok: false,
      kind,
      message: String(status),
      ...(status === 429 ? { retryAfterSeconds: 30 } : {}),
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("https://api.kick.com/public/v1/moderation/bans");
  });

  it("does not retry after an ambiguous connection failure", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection closed after write"))
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", request);
    expect(await run()).toEqual({
      ok: false,
      kind: "network",
      message: "Connection closed after write",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
