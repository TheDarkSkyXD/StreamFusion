import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelPrediction,
  createPrediction,
  getPredictions,
  lockPrediction,
  resolvePrediction,
} from "@/backend/api/platforms/twitch/twitch-helix-predictions";

let lastUrl: string | null = null;
let lastMethod: string | null = null;
let lastBody: unknown = null;

interface NextResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

let nextResponse: NextResponse = { status: 200, body: { data: [] } };

beforeEach(() => {
  lastUrl = null;
  lastMethod = null;
  lastBody = null;
  nextResponse = { status: 200, body: { data: [] } };
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

const PREDICTION = {
  id: "p1",
  broadcaster_id: "111",
  title: "Will we win?",
  winning_outcome_id: null,
  outcomes: [
    { id: "o1", title: "Yes", users: 0, channel_points: 0, color: "BLUE" },
    { id: "o2", title: "No", users: 0, channel_points: 0, color: "PINK" },
  ],
  prediction_window: 120,
  status: "ACTIVE",
  created_at: "2026-05-18T00:00:00Z",
  ended_at: null,
  locked_at: null,
};

describe("twitch-helix-predictions URL + method + body", () => {
  it("getPredictions → GET /predictions?broadcaster_id=…", async () => {
    nextResponse = { status: 200, body: { data: [PREDICTION] } };
    const result = await getPredictions({
      accessToken: "tok",
      broadcasterId: "111",
    });
    expect(lastMethod).toBe("GET");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/predictions?broadcaster_id=111",
    );
    expect(result.ok).toBe(true);
  });

  it("createPrediction → POST /predictions with body { broadcaster_id, title, outcomes:[{title}], prediction_window }", async () => {
    nextResponse = { status: 200, body: { data: [PREDICTION] } };
    await createPrediction({
      accessToken: "tok",
      broadcasterId: "111",
      title: "Will we win?",
      outcomes: [{ title: "Yes" }, { title: "No" }],
      predictionWindow: 120,
    });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://api.twitch.tv/helix/predictions");
    expect(lastBody).toEqual({
      broadcaster_id: "111",
      title: "Will we win?",
      outcomes: [{ title: "Yes" }, { title: "No" }],
      prediction_window: 120,
    });
  });

  it("lockPrediction → PATCH /predictions with body { broadcaster_id, id, status: 'LOCKED' }", async () => {
    nextResponse = { status: 200, body: { data: [PREDICTION] } };
    await lockPrediction({
      accessToken: "tok",
      broadcasterId: "111",
      predictionId: "p1",
    });
    expect(lastMethod).toBe("PATCH");
    expect(lastUrl).toBe("https://api.twitch.tv/helix/predictions");
    expect(lastBody).toEqual({
      broadcaster_id: "111",
      id: "p1",
      status: "LOCKED",
    });
  });

  it("resolvePrediction passes winning_outcome_id", async () => {
    nextResponse = { status: 200, body: { data: [PREDICTION] } };
    await resolvePrediction({
      accessToken: "tok",
      broadcasterId: "111",
      predictionId: "p1",
      winningOutcomeId: "o1",
    });
    expect(lastMethod).toBe("PATCH");
    expect(lastBody).toEqual({
      broadcaster_id: "111",
      id: "p1",
      status: "RESOLVED",
      winning_outcome_id: "o1",
    });
  });

  it("cancelPrediction → PATCH with status: 'CANCELED'", async () => {
    nextResponse = { status: 200, body: { data: [PREDICTION] } };
    await cancelPrediction({
      accessToken: "tok",
      broadcasterId: "111",
      predictionId: "p1",
    });
    expect(lastBody).toEqual({
      broadcaster_id: "111",
      id: "p1",
      status: "CANCELED",
    });
  });
});

describe("twitch-helix-predictions validation", () => {
  it("createPrediction throws synchronously when predictionWindow is out of [1, 1800]", () => {
    expect(() =>
      createPrediction({
        accessToken: "tok",
        broadcasterId: "111",
        title: "x",
        outcomes: [{ title: "a" }, { title: "b" }],
        predictionWindow: 0,
      }),
    ).toThrow(/predictionWindow/);
    expect(() =>
      createPrediction({
        accessToken: "tok",
        broadcasterId: "111",
        title: "x",
        outcomes: [{ title: "a" }, { title: "b" }],
        predictionWindow: 1801,
      }),
    ).toThrow(/predictionWindow/);
  });

  it("createPrediction throws when outcomes < 2 or has an empty title", () => {
    expect(() =>
      createPrediction({
        accessToken: "tok",
        broadcasterId: "111",
        title: "x",
        outcomes: [{ title: "a" }],
        predictionWindow: 120,
      }),
    ).toThrow(/outcomes/);
    expect(() =>
      createPrediction({
        accessToken: "tok",
        broadcasterId: "111",
        title: "x",
        outcomes: [{ title: "a" }, { title: "  " }],
        predictionWindow: 120,
      }),
    ).toThrow(/non-empty/);
  });
});

describe("twitch-helix-predictions error classification", () => {
  it("401 with 'Missing scope: channel:manage:predictions' → missing-scopes", async () => {
    nextResponse = {
      status: 401,
      body: {
        error: "Unauthorized",
        status: 401,
        message: "Missing scope: channel:manage:predictions",
      },
    };
    const result = await lockPrediction({
      accessToken: "tok",
      broadcasterId: "111",
      predictionId: "p1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("missing-scopes");
      if (result.kind === "missing-scopes") {
        expect(result.missingScopes).toEqual(["channel:manage:predictions"]);
      }
    }
  });
});
