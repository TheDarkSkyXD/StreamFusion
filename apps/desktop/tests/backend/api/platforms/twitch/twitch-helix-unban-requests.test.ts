import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getUnbanRequests,
  resolveUnbanRequest,
} from "@/backend/api/platforms/twitch/twitch-helix-unban-requests";

// Guards: Helix unban-requests CRUD — list (filterable by status), resolve (approve/deny + optional moderator_message). The status filter is a literal-union; resolve mutates exactly one record per call.

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

const BASE = {
  accessToken: "tok-1",
  clientId: "test-client-id",
  broadcasterId: "111",
  moderatorId: "222",
} as const;

describe("getUnbanRequests", () => {
  it("GETs /moderation/unban_requests with required params + first=20", async () => {
    await getUnbanRequests({ ...BASE, status: "pending" });
    expect(lastMethod).toBe("GET");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/unban_requests?broadcaster_id=111&moderator_id=222&status=pending&first=20",
    );
    expect(lastBody).toBeNull();
  });

  it("forwards status, user_id, and after when provided", async () => {
    await getUnbanRequests({
      ...BASE,
      status: "approved",
      userId: "555",
      after: "cursor-1",
    });
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/unban_requests?broadcaster_id=111&moderator_id=222&status=approved&user_id=555&after=cursor-1&first=20",
    );
  });

  it("returns data and pagination cursor on 200", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: [
          {
            id: "ur-1",
            broadcaster_id: "111",
            broadcaster_login: "b",
            broadcaster_name: "B",
            moderator_id: null,
            moderator_login: null,
            moderator_name: null,
            user_id: "u1",
            user_login: "viewer",
            user_name: "Viewer",
            text: "please",
            status: "pending",
            created_at: "2026-05-18T00:00:00Z",
            resolved_at: null,
            resolution_text: null,
          },
        ],
        pagination: { cursor: "next-page" },
      },
    };
    const result = await getUnbanRequests({ ...BASE, status: "pending" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.payload.data).toHaveLength(1);
    expect(result.payload.data[0].id).toBe("ur-1");
    expect(result.payload.pagination.cursor).toBe("next-page");
  });

  it("401 missing scope → missing-scopes", async () => {
    nextResponse = {
      status: 401,
      body: { message: "Missing scope: moderator:read:unban_requests" },
    };
    const result = await getUnbanRequests({ ...BASE, status: "pending" });
    if (result.ok || result.kind !== "missing-scopes") {
      throw new Error("expected missing-scopes");
    }
    expect(result.missingScopes).toEqual(["moderator:read:unban_requests"]);
  });

  it("403 → forbidden", async () => {
    nextResponse = { status: 403, body: { message: "no" } };
    const result = await getUnbanRequests({ ...BASE, status: "pending" });
    if (result.ok) throw new Error("expected error");
    expect(result.kind).toBe("forbidden");
  });

  it("429 with Retry-After → rate-limited", async () => {
    nextResponse = {
      status: 429,
      body: { message: "slow down" },
      headers: { "Retry-After": "30" },
    };
    const result = await getUnbanRequests({ ...BASE, status: "pending" });
    if (result.ok || result.kind !== "rate-limited") {
      throw new Error("expected rate-limited");
    }
    expect(result.retryAfterSeconds).toBe(30);
  });
});

describe("resolveUnbanRequest", () => {
  it("PATCHes /moderation/unban_requests with required params and includes resolution_text when present", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: [
          {
            id: "ur-1",
            broadcaster_id: "111",
            broadcaster_login: "b",
            broadcaster_name: "B",
            moderator_id: "222",
            moderator_login: "m",
            moderator_name: "M",
            user_id: "u1",
            user_login: "viewer",
            user_name: "Viewer",
            text: "please",
            status: "approved",
            created_at: "2026-05-18T00:00:00Z",
            resolved_at: "2026-05-18T01:00:00Z",
            resolution_text: "ok fine",
          },
        ],
      },
    };
    const result = await resolveUnbanRequest({
      ...BASE,
      unbanRequestId: "ur-1",
      status: "approved",
      resolutionText: "ok fine",
    });
    expect(lastMethod).toBe("PATCH");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/unban_requests?broadcaster_id=111&moderator_id=222&unban_request_id=ur-1&status=approved&resolution_text=ok+fine",
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.payload.id).toBe("ur-1");
    expect(result.payload.status).toBe("approved");
  });

  it("omits resolution_text from URL when not provided", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: [
          {
            id: "ur-2",
            broadcaster_id: "111",
            broadcaster_login: "b",
            broadcaster_name: "B",
            moderator_id: "222",
            moderator_login: "m",
            moderator_name: "M",
            user_id: "u1",
            user_login: "viewer",
            user_name: "Viewer",
            text: "please",
            status: "denied",
            created_at: "2026-05-18T00:00:00Z",
            resolved_at: "2026-05-18T01:00:00Z",
            resolution_text: null,
          },
        ],
      },
    };
    await resolveUnbanRequest({
      ...BASE,
      unbanRequestId: "ur-2",
      status: "denied",
    });
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/moderation/unban_requests?broadcaster_id=111&moderator_id=222&unban_request_id=ur-2&status=denied",
    );
  });

  it("forwards status=denied through the URL", async () => {
    await resolveUnbanRequest({
      ...BASE,
      unbanRequestId: "ur-3",
      status: "denied",
      resolutionText: "no",
    });
    expect(lastUrl).toContain("status=denied");
    expect(lastUrl).toContain("resolution_text=no");
  });

  it("401 missing scope → missing-scopes", async () => {
    nextResponse = {
      status: 401,
      body: { message: "Missing scope: moderator:manage:unban_requests" },
    };
    const result = await resolveUnbanRequest({
      ...BASE,
      unbanRequestId: "ur-1",
      status: "approved",
    });
    if (result.ok || result.kind !== "missing-scopes") {
      throw new Error("expected missing-scopes");
    }
    expect(result.missingScopes).toEqual(["moderator:manage:unban_requests"]);
  });

  it("403 → forbidden", async () => {
    nextResponse = { status: 403, body: { message: "nope" } };
    const result = await resolveUnbanRequest({
      ...BASE,
      unbanRequestId: "ur-1",
      status: "approved",
    });
    if (result.ok) throw new Error("expected error");
    expect(result.kind).toBe("forbidden");
  });
});
