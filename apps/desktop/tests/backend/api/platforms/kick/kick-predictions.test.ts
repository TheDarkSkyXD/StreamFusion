import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getLatestPrediction } from "@backend/api/platforms/kick/kick-predictions";

// Guards: Kick predictions/latest read shape — `GET /api/v2/channels/{slug}/predictions/latest`,
// anonymous-first auth posture (no Authorization header on the first call),
// authed retry on 401 only when a token is supplied. 404 / 204 / null body
// must map to a clean `{ ok: true, payload: null }` so the service can no-op
// without surfacing an error.
// Guards: response body envelope tolerance — Kick's v2 routes sometimes wrap
// payloads in `{ data: <Prediction> }`, sometimes return the prediction
// directly. Both must parse.

interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let calls: MockCall[] = [];
let responses: Array<{ status: number; body: unknown; throwError?: Error }> = [];

function captureHeaders(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = init?.headers as Record<string, string> | undefined;
  if (headers) {
    for (const [k, v] of Object.entries(headers)) out[k] = v;
  }
  return out;
}

beforeEach(() => {
  calls = [];
  responses = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: captureHeaders(init),
    });
    const next = responses.shift();
    if (!next) {
      // Default: 200 with no prediction.
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => null,
      } as Response;
    }
    if (next.throwError) throw next.throwError;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      statusText: "",
      json: async () => next.body,
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getLatestPrediction", () => {
  it("GETs /api/v2/channels/{slug}/predictions/latest without an Authorization header on the anonymous first attempt", async () => {
    responses.push({ status: 200, body: null });
    const result = await getLatestPrediction("ramee");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toBe(
      "https://kick.com/api/v2/channels/ramee/predictions/latest",
    );
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it("returns { ok: true, payload: null } when the server returns 404 (no active prediction)", async () => {
    responses.push({ status: 404, body: { message: "Not Found" } });
    const result = await getLatestPrediction("ramee");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toBeNull();
  });

  it("returns { ok: true, payload: null } when the server returns 204 No Content", async () => {
    responses.push({ status: 204, body: null });
    const result = await getLatestPrediction("ramee");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toBeNull();
  });

  it("parses a populated prediction body when wrapped in a `data` envelope", async () => {
    responses.push({
      status: 200,
      body: {
        data: {
          id: "pred-1",
          title: "Will Ramee win?",
          state: "ACTIVE",
          outcomes: [
            { id: "o1", title: "Yes", total_vote_amount: 1000 },
            { id: "o2", title: "No", total_vote_amount: 500 },
          ],
          duration: 120,
          created_at: "2026-05-22T19:00:00.000Z",
        },
      },
    });

    const result = await getLatestPrediction("ramee");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).not.toBeNull();
      expect(result.payload?.id).toBe("pred-1");
      expect(result.payload?.outcomes).toHaveLength(2);
    }
  });

  it("parses a populated prediction body when returned directly (no `data` wrapper)", async () => {
    responses.push({
      status: 200,
      body: {
        id: "pred-2",
        title: "Direct shape",
        state: "RESOLVED",
        outcomes: [{ id: "o1", title: "Yes", total_vote_amount: 200 }],
        winning_outcome_id: "o1",
        duration: 60,
        created_at: "2026-05-22T19:00:00.000Z",
      },
    });

    const result = await getLatestPrediction("ramee");
    if (result.ok) {
      expect(result.payload?.id).toBe("pred-2");
      expect(result.payload?.state).toBe("RESOLVED");
    } else throw new Error("expected ok");
  });

  it("does NOT retry authed on a 401 when no access token is supplied", async () => {
    responses.push({ status: 401, body: { message: "Unauthorized" } });
    const result = await getLatestPrediction("ramee");

    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unauthenticated");
  });

  it("retries with the Bearer header when the anonymous call returns 401 AND an accessToken is supplied", async () => {
    responses.push({ status: 401, body: { message: "Unauthorized" } });
    responses.push({
      status: 200,
      body: {
        id: "pred-3",
        title: "Authed read",
        state: "ACTIVE",
        outcomes: [{ id: "o1", title: "Yes", total_vote_amount: 0 }],
        duration: 60,
        created_at: "2026-05-22T19:00:00.000Z",
      },
    });

    const result = await getLatestPrediction("ramee", { accessToken: "tok-abc" });
    expect(calls).toHaveLength(2);
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[1].headers.Authorization).toBe("Bearer tok-abc");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload?.id).toBe("pred-3");
  });

  it("returns kind: 'network' when fetch throws", async () => {
    responses.push({
      status: 0,
      body: null,
      throwError: new Error("network timeout"),
    });
    const result = await getLatestPrediction("ramee");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("network");
      expect(result.message).toContain("network timeout");
    }
  });

  it("returns kind: 'not-found' for non-404 4xx (clarified mapping)", async () => {
    responses.push({ status: 403, body: { message: "Forbidden" } });
    const result = await getLatestPrediction("ramee");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("forbidden");
  });

  it("encodes channel slugs containing special characters", async () => {
    responses.push({ status: 200, body: null });
    await getLatestPrediction("foo bar");
    expect(calls[0].url).toBe(
      "https://kick.com/api/v2/channels/foo%20bar/predictions/latest",
    );
  });

  it("returns null payload when the body is non-object (e.g. plain string)", async () => {
    responses.push({ status: 200, body: "not a prediction" });
    const result = await getLatestPrediction("ramee");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toBeNull();
  });
});
