import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addModerator,
  addVip,
  banUser,
  clearChat,
  deleteChatMessage,
  removeModerator,
  removeVip,
  runCommercial,
  setShieldMode,
  startRaid,
  timeoutUser,
  unbanUser,
  updateChatSettings,
} from "@/backend/api/platforms/twitch/twitch-helix-moderation-mutations";

// Per-call capture for body / URL / method / headers inspection.
let lastUrl: string | null = null;
let lastMethod: string | null = null;
let lastBody: unknown = null;
let lastHeaders: Record<string, string> | null = null;

interface NextResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

let nextResponse: NextResponse = { status: 200, body: { data: [] } };
let nextThrow: Error | null = null;

const CTX = {
  accessToken: "tok-1",
  clientId: "test-client-id",
  broadcasterId: "111",
  moderatorId: "222",
};

beforeEach(() => {
  lastUrl = null;
  lastMethod = null;
  lastBody = null;
  lastHeaders = null;
  nextResponse = { status: 200, body: { data: [] } };
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
// URL / method / body construction — one per function
// ---------------------------------------------------------------------------

describe("URL + method + body construction", () => {
  it("banUser → POST /moderation/bans with { data: { user_id, reason } }", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: [
          {
            broadcaster_id: "111",
            moderator_id: "222",
            user_id: "333",
            created_at: "2026-05-18T00:00:00Z",
            end_time: null,
          },
        ],
      },
    };
    await banUser({ ...CTX, userId: "333", reason: "spam" });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/bans?broadcaster_id=111&moderator_id=222",
    );
    expect(lastBody).toEqual({ data: { user_id: "333", reason: "spam" } });
  });

  it("banUser omits reason when not provided", async () => {
    await banUser({ ...CTX, userId: "333" });
    expect(lastBody).toEqual({ data: { user_id: "333" } });
  });

  it("timeoutUser → POST /moderation/bans with duration", async () => {
    await timeoutUser({ ...CTX, userId: "333", durationSeconds: 300, reason: "cool off" });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/bans?broadcaster_id=111&moderator_id=222",
    );
    expect(lastBody).toEqual({
      data: { user_id: "333", duration: 300, reason: "cool off" },
    });
  });

  it("unbanUser → DELETE /moderation/bans with user_id query", async () => {
    nextResponse = { status: 204 };
    await unbanUser({ ...CTX, userId: "333" });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/bans?broadcaster_id=111&moderator_id=222&user_id=333",
    );
    expect(lastBody).toBeNull();
  });

  it("deleteChatMessage → DELETE /moderation/chat with message_id query", async () => {
    nextResponse = { status: 204 };
    await deleteChatMessage({ ...CTX, messageId: "abc-msg" });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/chat?broadcaster_id=111&moderator_id=222&message_id=abc-msg",
    );
  });

  it("clearChat → DELETE /moderation/chat without message_id query", async () => {
    nextResponse = { status: 204 };
    await clearChat(CTX);
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/chat?broadcaster_id=111&moderator_id=222",
    );
  });

  it("setShieldMode → PUT /moderation/shield_mode with { is_active }", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: [
          {
            is_active: true,
            moderator_id: "222",
            moderator_login: "mod",
            moderator_name: "Mod",
            last_activated_at: "2026-05-18T00:00:00Z",
          },
        ],
      },
    };
    await setShieldMode({ ...CTX, active: true });
    expect(lastMethod).toBe("PUT");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/shield_mode?broadcaster_id=111&moderator_id=222",
    );
    expect(lastBody).toEqual({ is_active: true });
  });

  it("startRaid → POST /raids with from/to broadcaster_id (no moderator_id)", async () => {
    nextResponse = {
      status: 200,
      body: { data: [{ created_at: "2026-05-18T00:00:00Z", is_mature: false }] },
    };
    await startRaid({ accessToken: "tok-1", clientId: "test-client-id", fromBroadcasterId: "111", toBroadcasterId: "999" });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/raids?from_broadcaster_id=111&to_broadcaster_id=999",
    );
    expect(lastBody).toBeNull();
  });

  it("runCommercial → POST /channels/commercial with body { broadcaster_id, length }", async () => {
    nextResponse = {
      status: 200,
      body: { data: [{ length: 60, message: "ok", retry_after: 480 }] },
    };
    await runCommercial({ accessToken: "tok-1", clientId: "test-client-id", broadcasterId: "111", length: 60 });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://api.twitch.tv/helix/channels/commercial");
    expect(lastBody).toEqual({ broadcaster_id: "111", length: 60 });
  });

  it("updateChatSettings → PATCH /chat/settings with the provided settings", async () => {
    nextResponse = {
      status: 200,
      body: { data: [{ broadcaster_id: "111", slow_mode: true }] },
    };
    await updateChatSettings({
      ...CTX,
      settings: { slow_mode: true, slow_mode_wait_time: 30 },
    });
    expect(lastMethod).toBe("PATCH");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/chat/settings?broadcaster_id=111&moderator_id=222",
    );
    expect(lastBody).toEqual({ slow_mode: true, slow_mode_wait_time: 30 });
  });

  it("addModerator → POST /moderation/moderators (no moderator_id)", async () => {
    nextResponse = { status: 204 };
    await addModerator({ accessToken: "tok-1", clientId: "test-client-id", broadcasterId: "111", userId: "333" });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=111&user_id=333",
    );
  });

  it("removeModerator → DELETE /moderation/moderators (no moderator_id)", async () => {
    nextResponse = { status: 204 };
    await removeModerator({ accessToken: "tok-1", clientId: "test-client-id", broadcasterId: "111", userId: "333" });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=111&user_id=333",
    );
  });

  it("addVip → POST /channels/vips", async () => {
    nextResponse = { status: 204 };
    await addVip({ accessToken: "tok-1", clientId: "test-client-id", broadcasterId: "111", userId: "333" });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://api.twitch.tv/helix/channels/vips?broadcaster_id=111&user_id=333");
  });

  it("removeVip → DELETE /channels/vips", async () => {
    nextResponse = { status: 204 };
    await removeVip({ accessToken: "tok-1", clientId: "test-client-id", broadcasterId: "111", userId: "333" });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe("https://api.twitch.tv/helix/channels/vips?broadcaster_id=111&user_id=333");
  });
});

// ---------------------------------------------------------------------------
// Synchronous input validation
// ---------------------------------------------------------------------------

describe("timeoutUser duration validation", () => {
  it("throws on 0", () => {
    expect(() => timeoutUser({ ...CTX, userId: "333", durationSeconds: 0 })).toThrow();
  });
  it("throws on -1", () => {
    expect(() => timeoutUser({ ...CTX, userId: "333", durationSeconds: -1 })).toThrow();
  });
  it("throws on 1_209_601", () => {
    expect(() =>
      timeoutUser({ ...CTX, userId: "333", durationSeconds: 1_209_601 }),
    ).toThrow();
  });
});

describe("runCommercial length validation", () => {
  it("throws on 0", () => {
    expect(() =>
      runCommercial({ accessToken: "tok-1", clientId: "test-client-id", broadcasterId: "111", length: 0 }),
    ).toThrow();
  });
  it("throws on 45 (not a multiple-of-30)", () => {
    expect(() =>
      runCommercial({ accessToken: "tok-1", clientId: "test-client-id", broadcasterId: "111", length: 45 }),
    ).toThrow();
  });
  it("throws on 210", () => {
    expect(() =>
      runCommercial({ accessToken: "tok-1", clientId: "test-client-id", broadcasterId: "111", length: 210 }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("happy paths", () => {
  it("banUser 200 returns { ok: true, payload: <parsed ban data> }", async () => {
    const ban = {
      broadcaster_id: "111",
      moderator_id: "222",
      user_id: "333",
      created_at: "2026-05-18T00:00:00Z",
      end_time: null,
    };
    nextResponse = { status: 200, body: { data: [ban] } };
    const result = await banUser({ ...CTX, userId: "333" });
    expect(result).toEqual({ ok: true, payload: ban });
  });

  it("unbanUser 204 returns { ok: true, payload: undefined }", async () => {
    nextResponse = { status: 204 };
    const result = await unbanUser({ ...CTX, userId: "333" });
    expect(result).toEqual({ ok: true, payload: undefined });
  });
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

describe("error classification", () => {
  it("401 with 'Missing scope: foo' → missing-scopes with [foo]", async () => {
    nextResponse = {
      status: 401,
      body: {
        error: "Unauthorized",
        status: 401,
        message: "Missing scope: moderator:manage:banned_users",
      },
    };
    const result = await banUser({ ...CTX, userId: "333" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("missing-scopes");
      if (result.kind === "missing-scopes") {
        expect(result.missingScopes).toEqual(["moderator:manage:banned_users"]);
        expect(result.message).toContain("Missing scope");
      }
    }
  });

  it("401 with multiple comma-separated scopes captures all", async () => {
    nextResponse = {
      status: 401,
      body: {
        error: "Unauthorized",
        status: 401,
        message: "Missing scopes: moderator:manage:banned_users, channel:manage:vips",
      },
    };
    const result = await banUser({ ...CTX, userId: "333" });
    if (result.ok || result.kind !== "missing-scopes") {
      throw new Error("expected missing-scopes");
    }
    expect(result.missingScopes).toEqual([
      "moderator:manage:banned_users",
      "channel:manage:vips",
    ]);
  });

  it("401 with no scope name parsable → missingScopes: []", async () => {
    nextResponse = {
      status: 401,
      body: { error: "Unauthorized", status: 401, message: "Missing scope:" },
    };
    const result = await banUser({ ...CTX, userId: "333" });
    if (result.ok || result.kind !== "missing-scopes") {
      throw new Error("expected missing-scopes");
    }
    expect(result.missingScopes).toEqual([]);
  });

  it("401 generic (no 'missing scope' text) → unauthorized", async () => {
    nextResponse = {
      status: 401,
      body: { error: "Unauthorized", status: 401, message: "Invalid OAuth token" },
    };
    const result = await banUser({ ...CTX, userId: "333" });
    if (result.ok) throw new Error("expected error");
    expect(result.kind).toBe("unauthorized");
  });

  it("403 → forbidden", async () => {
    nextResponse = {
      status: 403,
      body: { error: "Forbidden", status: 403, message: "not a moderator" },
    };
    const result = await banUser({ ...CTX, userId: "333" });
    if (result.ok) throw new Error("expected error");
    expect(result.kind).toBe("forbidden");
  });

  it("404 on unbanUser → not-found", async () => {
    nextResponse = {
      status: 404,
      body: { error: "Not Found", status: 404, message: "user not banned" },
    };
    const result = await unbanUser({ ...CTX, userId: "333" });
    if (result.ok) throw new Error("expected error");
    expect(result.kind).toBe("not-found");
  });

  it("429 with Retry-After: 45 → rate-limited, retryAfterSeconds=45", async () => {
    nextResponse = {
      status: 429,
      body: { error: "Too Many Requests", status: 429, message: "slow down" },
      headers: { "Retry-After": "45" },
    };
    const result = await banUser({ ...CTX, userId: "333" });
    if (result.ok || result.kind !== "rate-limited") {
      throw new Error("expected rate-limited");
    }
    expect(result.retryAfterSeconds).toBe(45);
  });

  it("429 without Retry-After → retryAfterSeconds=null", async () => {
    nextResponse = {
      status: 429,
      body: { error: "Too Many Requests", status: 429, message: "slow down" },
    };
    const result = await banUser({ ...CTX, userId: "333" });
    if (result.ok || result.kind !== "rate-limited") {
      throw new Error("expected rate-limited");
    }
    expect(result.retryAfterSeconds).toBeNull();
  });

  it("5xx → network", async () => {
    nextResponse = { status: 500, body: {} };
    const result = await banUser({ ...CTX, userId: "333" });
    if (result.ok) throw new Error("expected error");
    expect(result.kind).toBe("network");
  });

  it("fetch throws → network", async () => {
    nextThrow = new Error("connection refused");
    const result = await banUser({ ...CTX, userId: "333" });
    if (result.ok) throw new Error("expected error");
    expect(result.kind).toBe("network");
    expect(result.message).toContain("connection refused");
  });
});

// ---------------------------------------------------------------------------
// updateChatSettings: only-defined-keys
// ---------------------------------------------------------------------------

describe("updateChatSettings body shaping", () => {
  it("sends only the keys the caller provided (drops undefined)", async () => {
    nextResponse = {
      status: 200,
      body: { data: [{ broadcaster_id: "111" }] },
    };
    await updateChatSettings({
      ...CTX,
      settings: {
        slow_mode: true,
        // explicitly undefined — should be dropped
        follower_mode: undefined,
        subscriber_mode: undefined,
      },
    });
    expect(lastBody).toEqual({ slow_mode: true });
  });
});
