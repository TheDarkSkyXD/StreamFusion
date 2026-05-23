import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchChannelPrediction,
  normalizeTwitchPrediction,
} from "@/backend/api/platforms/twitch/twitch-gql-predictions";

// Guards: U3 viewer-side GQL prediction read — request wire shape (Client-Id
// always, OAuth header conditional on accessToken), three-auth-state matrix
// (guest → no Authorization → banner emits without viewerOutcomeId; authed →
// OAuth header → self block populates viewerOutcomeId/viewerStake), and the
// defensive normalizer that tolerates Twitch payload drift without throwing.

// ------------------------------------------------------------
// Wire-shape tests: fetchChannelPrediction
// ------------------------------------------------------------

let lastRequest: { headers: Record<string, string>; body: unknown } = {
  headers: {},
  body: null,
};
let nextResponse: { status: number; body: unknown } = { status: 200, body: { data: {} } };

beforeEach(() => {
  lastRequest = { headers: {}, body: null };
  nextResponse = { status: 200, body: { data: { channel: null } } };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      // Normalize the headers init to a flat record regardless of how it was
      // passed (Record / Headers / array-tuples).
      const raw = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(raw)) {
        headers[k] = v;
      }
    }
    lastRequest = {
      headers,
      body: init?.body ? JSON.parse(init.body as string) : null,
    };
    return {
      ok: nextResponse.status >= 200 && nextResponse.status < 300,
      status: nextResponse.status,
      statusText: "",
      json: async () => nextResponse.body,
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchChannelPrediction — request wire shape", () => {
  it("defaults Client-Id to the anonymous Android id when no clientId option is supplied (guest path)", async () => {
    nextResponse = { status: 200, body: { data: { channel: null } } };
    await fetchChannelPrediction("ramee");
    expect(lastRequest.headers["Client-Id"]).toBe("kd1unb4b3q4t58fwlpcbzcbnm76a8fp");
  });

  it("omits Authorization header when no accessToken is supplied (guest / no-OAuth path)", async () => {
    nextResponse = { status: 200, body: { data: { channel: null } } };
    await fetchChannelPrediction("ramee");
    expect(lastRequest.headers.Authorization).toBeUndefined();
  });

  it("falls back to anonymous (no Authorization) when accessToken is supplied WITHOUT a matching clientId", async () => {
    // Fail-closed: a user OAuth token paired with the anonymous Android Client-Id
    // would be rejected by Twitch with 401 (Client-Id must match the token's
    // owning client_id). Better to send no Authorization than to send a known-bad
    // pair and spam the console — matches the May 19 Helix fix pattern.
    nextResponse = { status: 200, body: { data: { channel: null } } };
    await fetchChannelPrediction("ramee", { accessToken: "tok-1" });
    expect(lastRequest.headers.Authorization).toBeUndefined();
    expect(lastRequest.headers["Client-Id"]).toBe("kd1unb4b3q4t58fwlpcbzcbnm76a8fp");
  });

  it("sends Authorization: OAuth <token> AND the app Client-Id when both accessToken and clientId are supplied", async () => {
    nextResponse = { status: 200, body: { data: { channel: null } } };
    await fetchChannelPrediction("ramee", {
      accessToken: "tok-1",
      clientId: "my-app-client-id",
    });
    // Twitch's auth invariant: Client-Id must match the token's owning client_id.
    // Pairing the user-OAuth token with the app's own Client-Id is the only way
    // GQL accepts the request (see commit 5fc5a23 for the Helix-side rationale).
    expect(lastRequest.headers["Client-Id"]).toBe("my-app-client-id");
    expect(lastRequest.headers.Authorization).toBe("OAuth tok-1");
  });

  it("uses the supplied clientId for anonymous calls too (no Authorization attached)", async () => {
    nextResponse = { status: 200, body: { data: { channel: null } } };
    await fetchChannelPrediction("ramee", { clientId: "my-app-client-id" });
    expect(lastRequest.headers["Client-Id"]).toBe("my-app-client-id");
    expect(lastRequest.headers.Authorization).toBeUndefined();
  });

  it("posts the ChannelPredictionContext operation with lowercased channelLogin variable", async () => {
    nextResponse = { status: 200, body: { data: { channel: null } } };
    await fetchChannelPrediction("Ramee");
    const body = lastRequest.body as {
      operationName: string;
      variables: { channelLogin: string };
      query: string;
    };
    expect(body.operationName).toBe("ChannelPredictionContext");
    expect(body.variables.channelLogin).toBe("ramee");
    // Document-string GQL until persisted-query hash is captured — query
    // body should request the load-bearing fields.
    expect(body.query).toContain("latestPrediction");
    expect(body.query).toContain("outcomes");
    expect(body.query).toContain("self");
  });
});

describe("fetchChannelPrediction — response handling", () => {
  it("returns null when channel.latestPrediction is null (no active prediction)", async () => {
    nextResponse = {
      status: 200,
      body: { data: { channel: { id: "12345", latestPrediction: null } } },
    };
    const result = await fetchChannelPrediction("ramee");
    expect(result).toBeNull();
  });

  it("returns null when channel itself is null (unknown channel)", async () => {
    nextResponse = {
      status: 200,
      body: { data: { channel: null } },
    };
    const result = await fetchChannelPrediction("ramee");
    expect(result).toBeNull();
  });

  it("normalizes a populated prediction with two outcomes and BLUE/PINK colors", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: {
          channel: {
            id: "12345",
            latestPrediction: {
              id: "pred-1",
              title: "Who wins?",
              status: "ACTIVE",
              predictionWindowSeconds: 120,
              winningOutcomeID: null,
              endedAt: null,
              outcomes: [
                {
                  id: "outcome-a",
                  title: "Sodapoppin",
                  color: "BLUE",
                  totalPoints: 1000,
                  totalUsers: 12,
                },
                {
                  id: "outcome-b",
                  title: "EggsQc",
                  color: "PINK",
                  totalPoints: 500,
                  totalUsers: 7,
                },
              ],
              self: null,
            },
          },
        },
      },
    };
    const result = await fetchChannelPrediction("ramee");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("pred-1");
    expect(result?.platform).toBe("twitch");
    expect(result?.channelId).toBe("12345");
    expect(result?.channelSlug).toBe("ramee");
    expect(result?.status).toBe("ACTIVE");
    expect(result?.outcomes).toHaveLength(2);
    // GQL enum colors come UPPERCASE; normalizer should lowercase to match
    // UnifiedPredictionOutcome.color literal.
    expect(result?.outcomes[0].color).toBe("blue");
    expect(result?.outcomes[1].color).toBe("pink");
    expect(result?.outcomes[0].totalAmount).toBe(1000);
    expect(result?.outcomes[1].totalAmount).toBe(500);
  });

  it("populates viewerOutcomeId and viewerStake from the self block when present (authed)", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: {
          channel: {
            id: "12345",
            latestPrediction: {
              id: "pred-1",
              title: "Who wins?",
              status: "ACTIVE",
              predictionWindowSeconds: 120,
              winningOutcomeID: null,
              endedAt: null,
              outcomes: [
                { id: "outcome-a", title: "A", color: "BLUE", totalPoints: 10, totalUsers: 1 },
                { id: "outcome-b", title: "B", color: "PINK", totalPoints: 20, totalUsers: 2 },
              ],
              self: { outcomeID: "outcome-a", points: 250 },
            },
          },
        },
      },
    };
    const result = await fetchChannelPrediction("ramee", {
      accessToken: "tok-1",
      clientId: "my-app-client-id",
    });
    expect(result?.viewerOutcomeId).toBe("outcome-a");
    expect(result?.viewerStake).toBe(250);
  });

  it("leaves viewerOutcomeId/viewerStake null when self is null (guest call)", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: {
          channel: {
            id: "12345",
            latestPrediction: {
              id: "pred-1",
              title: "Who wins?",
              status: "ACTIVE",
              predictionWindowSeconds: 120,
              winningOutcomeID: null,
              endedAt: null,
              outcomes: [
                { id: "outcome-a", title: "A", color: "BLUE", totalPoints: 10, totalUsers: 1 },
                { id: "outcome-b", title: "B", color: "PINK", totalPoints: 20, totalUsers: 2 },
              ],
              self: null,
            },
          },
        },
      },
    };
    const result = await fetchChannelPrediction("ramee");
    expect(result?.viewerOutcomeId).toBeNull();
    expect(result?.viewerStake).toBeNull();
  });

  it("propagates winningOutcomeId and endedAt on a RESOLVED prediction", async () => {
    nextResponse = {
      status: 200,
      body: {
        data: {
          channel: {
            id: "12345",
            latestPrediction: {
              id: "pred-1",
              title: "Who wins?",
              status: "RESOLVED",
              predictionWindowSeconds: 120,
              winningOutcomeID: "outcome-a",
              endedAt: "2026-05-22T19:02:00Z",
              outcomes: [
                { id: "outcome-a", title: "A", color: "BLUE", totalPoints: 10, totalUsers: 1 },
                { id: "outcome-b", title: "B", color: "PINK", totalPoints: 20, totalUsers: 2 },
              ],
              self: null,
            },
          },
        },
      },
    };
    const result = await fetchChannelPrediction("ramee");
    expect(result?.status).toBe("RESOLVED");
    expect(result?.winningOutcomeId).toBe("outcome-a");
    expect(result?.endedAt).toBe("2026-05-22T19:02:00Z");
  });

  it("throws on HTTP 401 so the poller can route through the refresh path", async () => {
    nextResponse = { status: 401, body: {} };
    await expect(fetchChannelPrediction("ramee")).rejects.toThrow(/401/);
  });

  it("throws on HTTP 500 (poller catches and skips the tick)", async () => {
    nextResponse = { status: 500, body: {} };
    await expect(fetchChannelPrediction("ramee")).rejects.toThrow(/500/);
  });

  it("throws when GQL `errors[]` is populated on a 200 response (server-side rejection)", async () => {
    nextResponse = {
      status: 200,
      body: { errors: [{ message: "Cannot query field X" }] },
    };
    await expect(fetchChannelPrediction("ramee")).rejects.toThrow();
  });
});

// ------------------------------------------------------------
// Normalizer unit tests (defensive parsing — no HTTP)
// ------------------------------------------------------------

describe("normalizeTwitchPrediction — defensive parsing", () => {
  function basicRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "pred-1",
      title: "Who wins?",
      status: "ACTIVE",
      predictionWindowSeconds: 120,
      winningOutcomeID: null,
      endedAt: null,
      outcomes: [
        { id: "outcome-a", title: "A", color: "BLUE", totalPoints: 10, totalUsers: 1 },
        { id: "outcome-b", title: "B", color: "PINK", totalPoints: 20, totalUsers: 2 },
      ],
      self: null,
      ...overrides,
    };
  }

  it("returns null when input is not an object", () => {
    expect(
      normalizeTwitchPrediction(null, { channelId: "12345", channelSlug: "ramee" }),
    ).toBeNull();
    expect(
      normalizeTwitchPrediction(42 as unknown, { channelId: "12345", channelSlug: "ramee" }),
    ).toBeNull();
  });

  it("returns null when id is missing", () => {
    const raw = basicRaw();
    delete raw.id;
    expect(
      normalizeTwitchPrediction(raw, { channelId: "12345", channelSlug: "ramee" }),
    ).toBeNull();
  });

  it("returns null when status is not in the valid set", () => {
    expect(
      normalizeTwitchPrediction(basicRaw({ status: "WAT" }), {
        channelId: "12345",
        channelSlug: "ramee",
      }),
    ).toBeNull();
  });

  it("normalizes lowercase status strings (defensive)", () => {
    const result = normalizeTwitchPrediction(basicRaw({ status: "active" }), {
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(result?.status).toBe("ACTIVE");
  });

  it("returns null when outcomes is empty (can't render a banner without options)", () => {
    expect(
      normalizeTwitchPrediction(basicRaw({ outcomes: [] }), {
        channelId: "12345",
        channelSlug: "ramee",
      }),
    ).toBeNull();
  });

  it("falls back color to null when GQL sends an unrecognized color value", () => {
    const result = normalizeTwitchPrediction(
      basicRaw({
        outcomes: [
          { id: "x", title: "X", color: "MAGENTA", totalPoints: 1, totalUsers: 1 },
          { id: "y", title: "Y", color: null, totalPoints: 2, totalUsers: 2 },
        ],
      }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(result?.outcomes[0].color).toBeNull();
    expect(result?.outcomes[1].color).toBeNull();
  });

  it("maps the sequential 3+-outcome palette (yellow / green / orange) to lowercase literals", () => {
    const result = normalizeTwitchPrediction(
      basicRaw({
        outcomes: [
          { id: "a", title: "A", color: "YELLOW", totalPoints: 1, totalUsers: 1 },
          { id: "b", title: "B", color: "GREEN", totalPoints: 2, totalUsers: 2 },
          { id: "c", title: "C", color: "ORANGE", totalPoints: 3, totalUsers: 3 },
        ],
      }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(
      result?.outcomes.map((o: { color: string | null }) => o.color),
    ).toEqual(["yellow", "green", "orange"]);
  });

  it("treats winningOutcomeID empty string as null", () => {
    const result = normalizeTwitchPrediction(
      basicRaw({ status: "RESOLVED", winningOutcomeID: "" }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(result?.winningOutcomeId).toBeNull();
  });

  it("threads channelId and channelSlug from opts onto the output", () => {
    const result = normalizeTwitchPrediction(basicRaw(), {
      channelId: "12345",
      channelSlug: "ramee",
    });
    expect(result?.channelId).toBe("12345");
    expect(result?.channelSlug).toBe("ramee");
  });

  it("parses nested user shape in topPredictors when present", () => {
    const result = normalizeTwitchPrediction(
      basicRaw({
        outcomes: [
          {
            id: "a",
            title: "A",
            color: "BLUE",
            totalPoints: 1000,
            totalUsers: 1,
            topPredictors: [
              { points: 250, user: { id: "u-1", login: "alice", displayName: "Alice" } },
              { points: 100, user: { id: "u-2", login: "bob", displayName: "Bob" } },
            ],
          },
          {
            id: "b",
            title: "B",
            color: "PINK",
            totalPoints: 0,
            totalUsers: 0,
          },
        ],
      }),
      { channelId: "12345", channelSlug: "ramee" },
    );
    expect(result?.outcomes[0].topPredictors).toEqual([
      { userId: "u-1", userName: "Alice", amount: 250 },
      { userId: "u-2", userName: "Bob", amount: 100 },
    ]);
    // Second outcome had no topPredictors — should be undefined (not empty array).
    expect(result?.outcomes[1].topPredictors).toBeUndefined();
  });
});
