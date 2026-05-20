import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getModerators,
  getVips,
} from "@/backend/api/platforms/twitch/twitch-helix-moderators-vips";

// Guards: Helix `GET /moderation/moderators` and `GET /channels/vips` envelopes — broadcaster_id required, cursor handoff, paging up to 100/page. Drift on the URL or the pagination shape silently empties the mod/VIP tables.

let lastUrl: string | null = null;
let lastMethod: string | null = null;
let lastBody: unknown = null;

interface NextResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

let nextResponse: NextResponse = { status: 200, body: { data: [], pagination: {} } };

beforeEach(() => {
  lastUrl = null;
  lastMethod = null;
  lastBody = null;
  nextResponse = { status: 200, body: { data: [], pagination: {} } };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    lastUrl = url;
    lastMethod = (init?.method as string) ?? "GET";
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

const CTX = { accessToken: "tok-1", clientId: "test-client-id", broadcasterId: "111" };

describe("getModerators", () => {
  it("GETs /moderation/moderators?broadcaster_id=&first=100", async () => {
    await getModerators(CTX);
    expect(lastMethod).toBe("GET");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=111&first=100",
    );
    expect(lastBody).toBeNull();
  });

  it("returns parsed data and pagination cursor on 200", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: [{ user_id: "u1", user_login: "mod1", user_name: "Mod1" }],
        pagination: { cursor: "abc" },
      },
    };
    const result = await getModerators(CTX);
    if (!result.ok) throw new Error("expected ok");
    expect(result.payload.data).toEqual([
      { user_id: "u1", user_login: "mod1", user_name: "Mod1" },
    ]);
    expect(result.payload.pagination.cursor).toBe("abc");
  });

  it("returns empty data when response has no data array", async () => {
    nextResponse = { status: 200, body: {} };
    const result = await getModerators(CTX);
    if (!result.ok) throw new Error("expected ok");
    expect(result.payload.data).toEqual([]);
    expect(result.payload.pagination.cursor).toBeUndefined();
  });

  it("401 with missing scope → missing-scopes", async () => {
    nextResponse = {
      status: 401,
      body: { message: "Missing scope: moderation:read" },
    };
    const result = await getModerators(CTX);
    if (result.ok || result.kind !== "missing-scopes") {
      throw new Error("expected missing-scopes");
    }
    expect(result.missingScopes).toEqual(["moderation:read"]);
  });

  it("403 → forbidden", async () => {
    nextResponse = { status: 403, body: { message: "nope" } };
    const result = await getModerators(CTX);
    if (result.ok) throw new Error("expected error");
    expect(result.kind).toBe("forbidden");
  });
});

describe("getVips", () => {
  it("GETs /channels/vips?broadcaster_id=&first=100", async () => {
    await getVips(CTX);
    expect(lastMethod).toBe("GET");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/channels/vips?broadcaster_id=111&first=100",
    );
  });

  it("returns parsed data on 200", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: [{ user_id: "v1", user_login: "vip1", user_name: "Vip1" }],
        pagination: {},
      },
    };
    const result = await getVips(CTX);
    if (!result.ok) throw new Error("expected ok");
    expect(result.payload.data[0].user_login).toBe("vip1");
  });

  it("401 with missing scope → missing-scopes", async () => {
    nextResponse = {
      status: 401,
      body: { message: "Missing scope: channel:read:vips" },
    };
    const result = await getVips(CTX);
    if (result.ok || result.kind !== "missing-scopes") {
      throw new Error("expected missing-scopes");
    }
    expect(result.missingScopes).toEqual(["channel:read:vips"]);
  });

  it("403 → forbidden", async () => {
    nextResponse = { status: 403, body: { message: "nope" } };
    const result = await getVips(CTX);
    if (result.ok) throw new Error("expected error");
    expect(result.kind).toBe("forbidden");
  });
});
