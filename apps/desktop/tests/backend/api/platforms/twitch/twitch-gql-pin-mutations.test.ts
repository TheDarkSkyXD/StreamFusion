import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pinChatMessage,
  unpinChatMessage,
} from "@/backend/api/platforms/twitch/twitch-gql-pin-mutations";

// Capture each fetch call so the tests can inspect the body Twitch receives.
let lastBody: unknown = null;
let nextResponse: { status: number; body: unknown } = { status: 200, body: { data: {} } };

beforeEach(() => {
  lastBody = null;
  nextResponse = { status: 200, body: { data: {} } };
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    lastBody = init?.body ? JSON.parse(init.body as string) : null;
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

describe("pinChatMessage", () => {
  it("sends the canonical PinChatMessage mutation with type: MOD and the given duration", async () => {
    const result = await pinChatMessage("19789903", "msg-1", 3600, "tok-1");

    expect(result).toEqual({ ok: true });
    expect(lastBody).toMatchObject({
      operationName: "PinChatMessage",
      variables: {
        input: {
          channelID: "19789903",
          messageID: "msg-1",
          durationSeconds: 3600,
          type: "MOD",
        },
      },
    });
  });

  it("omits durationSeconds when null (no-expiry pin)", async () => {
    await pinChatMessage("19789903", "msg-1", null, "tok-1");
    const input = (lastBody as { variables: { input: Record<string, unknown> } }).variables.input;
    expect(input).not.toHaveProperty("durationSeconds");
    expect(input).toMatchObject({
      channelID: "19789903",
      messageID: "msg-1",
      type: "MOD",
    });
  });

  it("classifies an 'unauthenticated' GQL error and surfaces it on the result", async () => {
    nextResponse = {
      status: 200,
      body: { errors: [{ message: "unauthenticated", path: ["pinChatMessage"] }] },
    };
    const result = await pinChatMessage("19789903", "msg-1", 3600, "tok-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unauthenticated");
    }
  });

  it("classifies a 'forbidden' error", async () => {
    nextResponse = { status: 200, body: { errors: [{ message: "Permission denied" }] } };
    const result = await pinChatMessage("19789903", "msg-1", 3600, "tok-1");
    if (!result.ok) {
      expect(result.kind).toBe("forbidden");
    } else {
      throw new Error("expected forbidden");
    }
  });

  it("classifies a non-2xx HTTP response as a network error", async () => {
    nextResponse = { status: 500, body: {} };
    const result = await pinChatMessage("19789903", "msg-1", 3600, "tok-1");
    if (!result.ok) {
      expect(result.kind).toBe("network");
    } else {
      throw new Error("expected network");
    }
  });
});

describe("unpinChatMessage", () => {
  it("sends UnpinChatMessage with the pin record id and reason: UNPIN", async () => {
    const result = await unpinChatMessage("pin-78bf3377", "tok-1");

    expect(result).toEqual({ ok: true });
    expect(lastBody).toMatchObject({
      operationName: "UnpinChatMessage",
      variables: {
        input: { id: "pin-78bf3377", reason: "UNPIN" },
      },
    });
  });

  it("surfaces unauthenticated errors", async () => {
    nextResponse = {
      status: 200,
      body: { errors: [{ message: "unauthenticated" }] },
    };
    const result = await unpinChatMessage("pin-x", "tok-1");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("unauthenticated");
    }
  });
});
