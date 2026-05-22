import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { voteOnPrediction } from "@/backend/api/platforms/kick/kick-prediction-mutations";

// Guards the Kick prediction-vote wire shape (POST /api/v2/channels/{slug}/predictions/vote
// with `{ outcomeId, amount }` body + Bearer auth), the input-validation gate that
// short-circuits invalid stakes before any fetch fires, and the discriminated-result
// kind mapping the UI consumes for per-error copy.

const VALID_PAYLOAD = {
  channelSlug: "ramee",
  predictionId: "pred-1",
  outcomeId: "outcome-a",
  amount: 100,
  accessToken: "tok-1",
};

let fetchMock: ReturnType<typeof vi.fn>;
let lastUrl = "";
let lastMethod = "";
let lastHeaders: Record<string, string> = {};
let lastBody: unknown = null;
let nextResponse: { status: number; body: unknown } = { status: 200, body: { ok: true } };

beforeEach(() => {
  lastUrl = "";
  lastMethod = "";
  lastHeaders = {};
  lastBody = null;
  nextResponse = { status: 200, body: { ok: true } };
  fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    lastUrl = url;
    lastMethod = init?.method || "GET";
    lastHeaders = (init?.headers as Record<string, string>) || {};
    lastBody = init?.body ? JSON.parse(init.body as string) : null;
    return {
      ok: nextResponse.status >= 200 && nextResponse.status < 300,
      status: nextResponse.status,
      statusText: "",
      json: async () => nextResponse.body,
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voteOnPrediction — happy path", () => {
  it("POSTs to /api/v2/channels/{slug}/predictions/vote with the JSON body", async () => {
    const result = await voteOnPrediction(VALID_PAYLOAD);

    expect(result.ok).toBe(true);
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://kick.com/api/v2/channels/ramee/predictions/vote");
    expect(lastBody).toEqual({ outcomeId: "outcome-a", amount: 100 });
  });

  it("sends Bearer authorization with the supplied access token", async () => {
    await voteOnPrediction(VALID_PAYLOAD);
    expect(lastHeaders.Authorization).toBe("Bearer tok-1");
  });

  it("returns ok:true and surfaces payload when the server returns a body", async () => {
    nextResponse = { status: 200, body: { id: "v-1", state: "ACTIVE" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result).toEqual({ ok: true, payload: { id: "v-1", state: "ACTIVE" } });
  });
});

describe("voteOnPrediction — input validation", () => {
  it("rejects amount: 0 with invalidInput before firing fetch", async () => {
    const result = await voteOnPrediction({ ...VALID_PAYLOAD, amount: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects negative amount with invalidInput before firing fetch", async () => {
    const result = await voteOnPrediction({ ...VALID_PAYLOAD, amount: -5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects amount > 250000 with invalidInput before firing fetch", async () => {
    const result = await voteOnPrediction({ ...VALID_PAYLOAD, amount: 250_001 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("invalidInput");
      expect(result.message).toContain("250000");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty outcomeId with invalidInput before firing fetch", async () => {
    const result = await voteOnPrediction({ ...VALID_PAYLOAD, outcomeId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty channelSlug with invalidInput — guards against `/channels//predictions/vote` 405 from dev sentinel", async () => {
    const result = await voteOnPrediction({ ...VALID_PAYLOAD, channelSlug: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only channelSlug with invalidInput", async () => {
    const result = await voteOnPrediction({ ...VALID_PAYLOAD, channelSlug: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("voteOnPrediction — status mapping", () => {
  it("classifies 401 as unauthenticated", async () => {
    nextResponse = { status: 401, body: { message: "Unauthorized" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unauthenticated");
  });

  it("classifies 403 as forbidden", async () => {
    nextResponse = { status: 403, body: { message: "Forbidden" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("forbidden");
  });

  it("classifies 404 as predictionGone", async () => {
    nextResponse = { status: 404, body: { message: "Not Found" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("predictionGone");
  });

  it("classifies 500 as network", async () => {
    nextResponse = { status: 500, body: { message: "Server Error" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
  });

  it("classifies 503 as network", async () => {
    nextResponse = { status: 503, body: null };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
  });
});

describe("voteOnPrediction — 422 body parsing", () => {
  it("classifies 422 with insufficient-balance text as insufficientBalance", async () => {
    nextResponse = {
      status: 422,
      body: { message: "Insufficient channel points balance" },
    };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("insufficientBalance");
  });

  it("classifies 422 mentioning 'funds' as insufficientBalance", async () => {
    nextResponse = { status: 422, body: { message: "Not enough funds" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("insufficientBalance");
  });

  it("classifies 422 with 'locked' text as outcomeLocked", async () => {
    nextResponse = { status: 422, body: { message: "Outcome is locked" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("outcomeLocked");
  });

  it("classifies 422 with 'closed' text as outcomeLocked", async () => {
    nextResponse = { status: 422, body: { message: "Voting is closed" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("outcomeLocked");
  });

  it("classifies 422 with 'ended' text as outcomeLocked", async () => {
    nextResponse = { status: 422, body: { message: "Prediction has ended" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("outcomeLocked");
  });

  it("classifies 422 with unrelated body as unknown", async () => {
    nextResponse = { status: 422, body: { message: "Validation failed" } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unknown");
  });
});

describe("voteOnPrediction — timeout + fetch failure", () => {
  it("maps AbortError to kind:network message:'timeout'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Mimic what AbortSignal.timeout produces in real browsers.
        throw new DOMException("The operation was aborted", "AbortError");
      }),
    );
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("network");
      expect(result.message).toBe("timeout");
    }
  });

  it("maps generic fetch error to kind:network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("network");
      expect(result.message).toBe("ECONNRESET");
    }
  });
});

describe("voteOnPrediction — sanitization", () => {
  it("strips 40+ char alphanumeric runs from unknown-kind messages", async () => {
    // 80-char alphanumeric run inside the body. Status 418 (teapot) lands in
    // the `kind: "unknown"` branch where the body is surfaced to `message`.
    const longToken = "a".repeat(80);
    nextResponse = {
      status: 418,
      body: { message: `something went wrong with key ${longToken} please retry` },
    };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unknown");
      expect(result.message).not.toContain(longToken);
      expect(result.message).toContain("[redacted]");
    }
  });

  it("truncates unknown-kind messages to <= 200 chars", async () => {
    const longText = "x".repeat(500);
    nextResponse = { status: 418, body: { message: longText } };
    const result = await voteOnPrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unknown");
      expect(result.message.length).toBeLessThanOrEqual(200);
    }
  });
});
