import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makePrediction,
  type MakePredictionPayload,
} from "@/backend/api/platforms/twitch/twitch-gql-prediction-mutations";

// Guards: Twitch GQL MakePrediction wire shape — persisted-query hash, all four
// variables (including auto-generated transactionID) in `input`, OAuth (not Bearer)
// auth header, Android Client-Id. Twitch rotates persisted hashes — when that
// happens the PersistedQueryNotFound retry path must fire with a document-string
// body carrying the same variable shape. Sanitization + integrity classification
// mirror U2's hygiene pattern so the renderer never echoes tokens or treats a
// rate-limit as a generic 4xx.

const VALID_PAYLOAD: MakePredictionPayload = {
  accessToken: "tok-1",
  eventID: "ev-1",
  outcomeID: "outcome-a",
  points: 100,
};

const HEX_TRANSACTION_ID = /^[0-9a-f]{32}$/;

let fetchMock: ReturnType<typeof vi.fn>;
let lastUrl = "";
let lastMethod = "";
let lastHeaders: Record<string, string> = {};
let lastBody: any = null;
let nextResponse: { status: number; body: unknown } = {
  status: 200,
  body: { data: { makePrediction: { prediction: { id: "p-1", status: "ACTIVE" } } } },
};

beforeEach(() => {
  lastUrl = "";
  lastMethod = "";
  lastHeaders = {};
  lastBody = null;
  nextResponse = {
    status: 200,
    body: { data: { makePrediction: { prediction: { id: "p-1", status: "ACTIVE" } } } },
  };
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
  vi.restoreAllMocks();
});

describe("makePrediction — happy path + wire shape", () => {
  it("POSTs to gql.twitch.tv/gql with the persisted-query hash", async () => {
    const result = await makePrediction(VALID_PAYLOAD);

    expect(result.ok).toBe(true);
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://gql.twitch.tv/gql");
    expect(lastBody.operationName).toBe("MakePrediction");
    expect(lastBody.extensions?.persistedQuery?.sha256Hash).toBe(
      "b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8",
    );
    expect(lastBody.extensions?.persistedQuery?.version).toBe(1);
    // Persisted-query path does NOT send a document string.
    expect(lastBody.query).toBeUndefined();
  });

  it("includes all four MakePredictionInput fields in variables", async () => {
    await makePrediction(VALID_PAYLOAD);
    const input = lastBody.variables.input;
    expect(input.eventID).toBe("ev-1");
    expect(input.outcomeID).toBe("outcome-a");
    expect(input.points).toBe(100);
    expect(input.transactionID).toMatch(HEX_TRANSACTION_ID);
  });

  it("auto-generates a fresh transactionID per call", async () => {
    await makePrediction(VALID_PAYLOAD);
    const firstTx = lastBody.variables.input.transactionID;

    await makePrediction(VALID_PAYLOAD);
    const secondTx = lastBody.variables.input.transactionID;

    expect(firstTx).toMatch(HEX_TRANSACTION_ID);
    expect(secondTx).toMatch(HEX_TRANSACTION_ID);
    expect(firstTx).not.toBe(secondTx);
  });

  it("uses caller-supplied transactionID when provided", async () => {
    await makePrediction({ ...VALID_PAYLOAD, transactionID: "caller-supplied-tx" });
    expect(lastBody.variables.input.transactionID).toBe("caller-supplied-tx");
  });

  it("sends Authorization as 'OAuth <token>' (NOT Bearer)", async () => {
    await makePrediction(VALID_PAYLOAD);
    expect(lastHeaders.Authorization).toBe("OAuth tok-1");
    expect(lastHeaders.Authorization).not.toContain("Bearer");
  });

  it("sends the Android Client-Id used elsewhere in the codebase", async () => {
    await makePrediction(VALID_PAYLOAD);
    expect(lastHeaders["Client-Id"]).toBe("kd1unb4b3q4t58fwlpcbzcbnm76a8fp");
  });

  it("surfaces the prediction payload on success", async () => {
    nextResponse = {
      status: 200,
      body: { data: { makePrediction: { prediction: { id: "p-2", points: 500 } } } },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toBeDefined();
    }
  });
});

describe("makePrediction — input validation", () => {
  it("rejects points: 0 with invalidInput before firing fetch", async () => {
    const result = await makePrediction({ ...VALID_PAYLOAD, points: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects negative points with invalidInput", async () => {
    const result = await makePrediction({ ...VALID_PAYLOAD, points: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects points > 250000 with invalidInput", async () => {
    const result = await makePrediction({ ...VALID_PAYLOAD, points: 250_001 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("invalidInput");
      expect(result.message).toContain("250000");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty eventID with invalidInput", async () => {
    const result = await makePrediction({ ...VALID_PAYLOAD, eventID: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty outcomeID with invalidInput", async () => {
    const result = await makePrediction({ ...VALID_PAYLOAD, outcomeID: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("invalidInput");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("makePrediction — inner error.code mapping", () => {
  it("classifies INSUFFICIENT_CHANNEL_POINTS as insufficientBalance", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: {
          makePrediction: { error: { code: "INSUFFICIENT_CHANNEL_POINTS" } },
        },
      },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("insufficientBalance");
  });

  it("classifies EVENT_LOCKED as outcomeLocked", async () => {
    nextResponse = {
      status: 200,
      body: { data: { makePrediction: { error: { code: "EVENT_LOCKED" } } } },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("outcomeLocked");
  });

  it("classifies OUTCOME_LOCKED as outcomeLocked", async () => {
    nextResponse = {
      status: 200,
      body: { data: { makePrediction: { error: { code: "OUTCOME_LOCKED" } } } },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("outcomeLocked");
  });

  it("classifies EVENT_NOT_FOUND as predictionGone", async () => {
    nextResponse = {
      status: 200,
      body: { data: { makePrediction: { error: { code: "EVENT_NOT_FOUND" } } } },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("predictionGone");
  });

  it("classifies PREDICTION_NOT_FOUND as predictionGone", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: { makePrediction: { error: { code: "PREDICTION_NOT_FOUND" } } },
      },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("predictionGone");
  });

  it("classifies unrecognized inner error codes as unknown", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: { makePrediction: { error: { code: "SOME_NEW_CODE_TWITCH_ADDED" } } },
      },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unknown");
  });
});

describe("makePrediction — HTTP-level errors", () => {
  it("classifies HTTP 401 as unauthenticated", async () => {
    nextResponse = { status: 401, body: { errors: [{ message: "Unauthorized" }] } };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unauthenticated");
  });

  it("classifies HTTP 403 + body matching integrity shape (lower-cased message) as integrity", async () => {
    nextResponse = {
      status: 403,
      body: { errors: [{ message: "failed integrity check" }] },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("integrity");
  });

  it("classifies HTTP 403 + extensions.code containing INTEGRITY as integrity", async () => {
    nextResponse = {
      status: 403,
      body: {
        errors: [
          { message: "Bad Request", extensions: { code: "INTEGRITY_FAILED" } },
        ],
      },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("integrity");
  });

  it("does not false-positive integrity on a 403 with unrelated body", async () => {
    // "integrity" alone (without check/failed/rejected co-occurrence) and no
    // INTEGRITY code in extensions should NOT trip the integrity branch.
    nextResponse = {
      status: 403,
      body: { errors: [{ message: "Cannot query field 'integrity' on type" }] },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).not.toBe("integrity");
  });

  it("classifies HTTP 500 as network", async () => {
    nextResponse = { status: 500, body: null };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("network");
  });
});

describe("makePrediction — GQL-level integrity in 200 envelope", () => {
  it("classifies 200 + integrity GQL error as integrity", async () => {
    nextResponse = {
      status: 200,
      body: { errors: [{ message: "failed integrity check" }] },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("integrity");
  });
});

describe("makePrediction — timeout + network errors", () => {
  it("maps AbortError to kind:network message:'timeout'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted", "AbortError");
      }),
    );
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("network");
      expect(result.message).toBe("timeout");
    }
  });

  it("maps a generic fetch error to kind:network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("network");
      expect(result.message).toBe("ECONNRESET");
    }
  });
});

describe("makePrediction — PersistedQueryNotFound fallback", () => {
  it("retries with a document-string mutation when the persisted hash is rejected", async () => {
    let call = 0;
    const responses = [
      // First call: persisted query rejected.
      {
        ok: true,
        status: 200,
        statusText: "",
        json: async () => ({
          errors: [{ message: "PersistedQueryNotFound" }],
        }),
      },
      // Second call: doc-string path succeeds.
      {
        ok: true,
        status: 200,
        statusText: "",
        json: async () => ({
          data: { makePrediction: { prediction: { id: "p-9", status: "ACTIVE" } } },
        }),
      },
    ];
    const calls: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          body: init?.body ? JSON.parse(init.body as string) : null,
        });
        const next = responses[call++];
        return next as unknown as Response;
      }),
    );

    const result = await makePrediction(VALID_PAYLOAD);

    expect(calls).toHaveLength(2);
    // First call carried the persisted-query hash.
    expect(calls[0].body.extensions?.persistedQuery?.sha256Hash).toBe(
      "b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8",
    );
    expect(calls[0].body.query).toBeUndefined();
    // Second call carried the document-string body, no persisted-query envelope.
    expect(calls[1].body.query).toContain("mutation MakePrediction");
    expect(calls[1].body.query).toContain("makePrediction(input: $input)");
    expect(calls[1].body.extensions?.persistedQuery).toBeUndefined();
    // Variables shape is preserved across the fallback (same transactionID).
    expect(calls[1].body.variables.input.eventID).toBe("ev-1");
    expect(calls[1].body.variables.input.outcomeID).toBe("outcome-a");
    expect(calls[1].body.variables.input.points).toBe(100);
    expect(calls[1].body.variables.input.transactionID).toBe(
      calls[0].body.variables.input.transactionID,
    );
    expect(result.ok).toBe(true);
  });
});

describe("makePrediction — sanitization", () => {
  it("strips 40+ char alphanumeric runs from unknown-kind messages", async () => {
    const longToken = "a".repeat(80);
    nextResponse = {
      status: 200,
      body: {
        errors: [{ message: `something went wrong with key ${longToken} please retry` }],
      },
    };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unknown");
      expect(result.message).not.toContain(longToken);
      expect(result.message).toContain("[redacted]");
    }
  });

  it("truncates unknown-kind messages to <= 200 chars", async () => {
    const longText = "x".repeat(500);
    nextResponse = { status: 200, body: { errors: [{ message: longText }] } };
    const result = await makePrediction(VALID_PAYLOAD);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unknown");
      expect(result.message.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("makePrediction — crypto.getRandomValues usage", () => {
  it("uses crypto.getRandomValues (NOT Math.random) for transactionID", async () => {
    const cryptoSpy = vi.spyOn(crypto, "getRandomValues");
    const randomSpy = vi.spyOn(Math, "random");

    await makePrediction(VALID_PAYLOAD);

    expect(cryptoSpy).toHaveBeenCalled();
    // Argument to getRandomValues is the 16-byte Uint8Array.
    const arg = cryptoSpy.mock.calls[0][0];
    expect(arg).toBeInstanceOf(Uint8Array);
    expect((arg as Uint8Array).byteLength).toBe(16);

    // Math.random should NOT have been called for transactionID generation.
    // (Other code paths in the file don't call Math.random; this asserts the
    // contract that the unsafe PRNG isn't used.)
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it("skips crypto.getRandomValues when the caller supplies a transactionID", async () => {
    const cryptoSpy = vi.spyOn(crypto, "getRandomValues");
    await makePrediction({ ...VALID_PAYLOAD, transactionID: "fixed-tx" });
    expect(cryptoSpy).not.toHaveBeenCalled();
    expect(lastBody.variables.input.transactionID).toBe("fixed-tx");
  });
});
