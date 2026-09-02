import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  banKickUser,
  banKickUserOfficial,
  deleteKickMessage,
  setKickChatMode,
  timeoutKickUser,
  timeoutKickUserOfficial,
  unbanKickUser,
  unbanKickUserOfficial,
} from "@backend/api/platforms/kick/kick-mod-mutations";

// Guards: Kick v2 moderation mutations — ban (permanent=true), timeout (permanent=false + duration), unban, delete-message, set-chat-mode. Each pins URL + method + body envelope so a casual refactor that "simplifies" the request shape doesn't silently 4xx mod actions.

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

describe("banKickUser", () => {
  it("POSTs official /public/v1/moderation/bans when stable IDs are available", async () => {
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "spammer",
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://api.kick.com/public/v1/moderation/bans");
    expect(lastBody).toEqual({ broadcaster_user_id: 123, user_id: 456 });
    expect(lastHeaders?.Authorization).toBe("Bearer tok-1");
  });

  it("POSTs to /api/v2/channels/{slug}/bans with permanent=true", async () => {
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "spammer",
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://kick.com/api/v2/channels/ac7ionman/bans");
    expect(lastBody).toEqual({ banned_username: "spammer", permanent: true });
    expect(lastHeaders?.Authorization).toBe("Bearer tok-1");
  });

  it("URL-encodes the channel slug", async () => {
    await banKickUser({
      channelSlug: "needs encoding",
      username: "spammer",
      accessToken: "tok-1",
    });
    expect(lastUrl).toBe("https://kick.com/api/v2/channels/needs%20encoding/bans");
  });
});

describe("timeoutKickUser", () => {
  it("POSTs official /public/v1/moderation/bans with duration when stable IDs are available", async () => {
    const result = await timeoutKickUser({
      channelSlug: "ac7ionman",
      username: "spammer",
      broadcasterUserId: 123,
      userId: 456,
      duration: 10,
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    expect(lastUrl).toBe("https://api.kick.com/public/v1/moderation/bans");
    expect(lastBody).toEqual({ broadcaster_user_id: 123, user_id: 456, duration: 10 });
  });

  it("POSTs to /api/v2/channels/{slug}/bans with permanent=false and duration passed through as-is", async () => {
    const result = await timeoutKickUser({
      channelSlug: "ac7ionman",
      username: "spammer",
      duration: 10, // minutes per Kick's API — helper does not convert
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://kick.com/api/v2/channels/ac7ionman/bans");
    expect(lastBody).toEqual({
      banned_username: "spammer",
      duration: 10,
      permanent: false,
    });
  });

  it("preserves an unusual duration value verbatim (no unit conversion)", async () => {
    await timeoutKickUser({
      channelSlug: "ac7ionman",
      username: "spammer",
      duration: 4321,
      accessToken: "tok-1",
    });
    expect(lastBody).toMatchObject({ duration: 4321 });
  });
});

describe("unbanKickUser", () => {
  it("DELETEs official /public/v1/moderation/bans with broadcaster and user IDs", async () => {
    const result = await unbanKickUser({
      channelSlug: "ac7ionman",
      username: "spammer",
      broadcasterUserId: 123,
      userId: 456,
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe("https://api.kick.com/public/v1/moderation/bans");
    expect(lastBody).toEqual({ broadcaster_user_id: 123, user_id: 456 });
  });

  it("DELETEs /api/v2/channels/{slug}/bans/{username}", async () => {
    const result = await unbanKickUser({
      channelSlug: "ac7ionman",
      username: "spammer",
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe("https://kick.com/api/v2/channels/ac7ionman/bans/spammer");
    expect(lastBody).toBeNull();
  });

  it("URL-encodes both slug and username", async () => {
    await unbanKickUser({
      channelSlug: "weird slug",
      username: "weird name",
      accessToken: "tok-1",
    });
    expect(lastUrl).toBe(
      "https://kick.com/api/v2/channels/weird%20slug/bans/weird%20name",
    );
  });
});

describe("deleteKickMessage", () => {
  it("DELETEs official /public/v1/chat/{messageId}", async () => {
    const result = await deleteKickMessage({
      chatroomId: 12345,
      messageId: "msg-uuid-1",
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe("https://api.kick.com/public/v1/chat/msg-uuid-1");
  });

  it("falls back to legacy chatroom delete when official delete has a non-auth failure", async () => {
    const statuses = [500, 200];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const status = statuses.shift() ?? 200;
      lastUrl = url;
      lastMethod = (init?.method as string) ?? "GET";
      lastHeaders = (init?.headers as Record<string, string>) ?? {};
      lastBody = init?.body ? JSON.parse(init.body as string) : null;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "",
        headers: new Headers(),
        json: async () => ({ message: status === 500 ? "Server error" : "ok" }),
      } as Response;
    });

    const result = await deleteKickMessage({
      chatroomId: 12345,
      messageId: "msg-uuid-1",
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
    expect(lastUrl).toBe("https://kick.com/api/v2/chatrooms/12345/messages/msg-uuid-1");
  });

  it.each([401, 403] as const)(
    "falls back to legacy chatroom delete after official %s",
    async (status) => {
      const statuses = [status, 200];
      const urls: string[] = [];
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        const nextStatus = statuses.shift() ?? 200;
        urls.push(url);
        lastUrl = url;
        lastMethod = (init?.method as string) ?? "GET";
        lastHeaders = (init?.headers as Record<string, string>) ?? {};
        lastBody = init?.body ? JSON.parse(init.body as string) : null;
        return {
          ok: nextStatus >= 200 && nextStatus < 300,
          status: nextStatus,
          statusText: "",
          headers: new Headers(),
          json: async () => ({ message: nextStatus === 200 ? "ok" : "Official API rejected" }),
        } as Response;
      });

      const result = await deleteKickMessage({
        chatroomId: 12345,
        messageId: "msg-uuid-1",
        accessToken: "tok-1",
      });

      expect(result).toEqual({ ok: true });
      expect(urls).toEqual([
        "https://api.kick.com/public/v1/chat/msg-uuid-1",
        "https://kick.com/api/v2/chatrooms/12345/messages/msg-uuid-1",
      ]);
    }
  );
});

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
// setKickChatMode — one test per mode key + a combined test
// ---------------------------------------------------------------------------

describe("setKickChatMode", () => {
  it("POSTs to /api/v2/channels/{slug}/chatroom — slow mode on", async () => {
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

  it("slow mode off → { slow_mode: { enabled: false, message_interval: 0 } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { slowMode: { enabled: false } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({
      slow_mode: { enabled: false, message_interval: 0 },
    });
  });

  it("followers-only on → { followers_mode: { enabled: true, min_duration: N } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { followersOnly: { enabled: true, minutes: 120 } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({
      followers_mode: { enabled: true, min_duration: 120 },
    });
  });

  it("followers-only off → { followers_mode: { enabled: false, min_duration: 0 } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { followersOnly: { enabled: false } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({
      followers_mode: { enabled: false, min_duration: 0 },
    });
  });

  it("subscribers-only on → { subscribers_mode: { enabled: true } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { subscribersOnly: { enabled: true } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({ subscribers_mode: { enabled: true } });
  });

  it("subscribers-only off → { subscribers_mode: { enabled: false } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { subscribersOnly: { enabled: false } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({ subscribers_mode: { enabled: false } });
  });

  it("emote-only on → { emotes_mode: { enabled: true } }", async () => {
    await setKickChatMode({
      channelSlug: "ac7ionman",
      update: { emoteOnly: { enabled: true } },
      accessToken: "tok-1",
    });
    expect(lastBody).toEqual({ emotes_mode: { enabled: true } });
  });

  it("emote-only off → { emotes_mode: { enabled: false } }", async () => {
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

describe("banKickUser classification", () => {
  it("401 → unauthenticated", async () => {
    nextResponse = { status: 401, body: { message: "Unauthorized" } };
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "u",
      accessToken: "tok-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unauthenticated");
  });

  it("403 → forbidden", async () => {
    nextResponse = { status: 403, body: { message: "Forbidden" } };
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "u",
      accessToken: "tok-1",
    });
    if (!result.ok) expect(result.kind).toBe("forbidden");
    else throw new Error("expected forbidden");
  });

  it("404 → not-found", async () => {
    nextResponse = { status: 404, body: { message: "Not Found" } };
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "u",
      accessToken: "tok-1",
    });
    if (!result.ok) expect(result.kind).toBe("not-found");
    else throw new Error("expected not-found");
  });

  it("429 with Retry-After: 30 → rate-limited, retryAfterSeconds=30", async () => {
    nextResponse = {
      status: 429,
      body: { message: "slow down" },
      headers: { "Retry-After": "30" },
    };
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "u",
      accessToken: "tok-1",
    });
    if (result.ok || result.kind !== "rate-limited") {
      throw new Error("expected rate-limited");
    }
    expect(result.retryAfterSeconds).toBe(30);
  });

  it("429 without Retry-After → retryAfterSeconds=null", async () => {
    nextResponse = { status: 429, body: { message: "slow down" } };
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "u",
      accessToken: "tok-1",
    });
    if (result.ok || result.kind !== "rate-limited") {
      throw new Error("expected rate-limited");
    }
    expect(result.retryAfterSeconds).toBeNull();
  });

  it("500 → network", async () => {
    nextResponse = { status: 500, body: { message: "boom" } };
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "u",
      accessToken: "tok-1",
    });
    if (!result.ok) expect(result.kind).toBe("network");
    else throw new Error("expected network");
  });

  it("fetch throws → { ok: false, kind: 'network' }", async () => {
    nextThrow = new Error("ECONNREFUSED");
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "u",
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
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "u",
      accessToken: "tok-1",
    });
    expect(result).toEqual({ ok: true });
  });

  it("400 with body containing 'forbidden' classifies as 'forbidden'", async () => {
    nextResponse = {
      status: 400,
      body: { message: "Action forbidden for this user" },
    };
    const result = await banKickUser({
      channelSlug: "ac7ionman",
      username: "u",
      accessToken: "tok-1",
    });
    if (!result.ok) expect(result.kind).toBe("forbidden");
    else throw new Error("expected forbidden");
  });
});
