import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pinChatMessage,
  unpinChatMessage,
} from "@/backend/api/platforms/twitch/twitch-gql-pin-mutations";

// Guards: Twitch Helix chat-pin wire shape - pin/unpin must use the official /chat/pins endpoint with broadcaster_id, moderator_id, message_id, and a client id matching the user token.
// Guards: Helix missing-scope responses surface as missing-scopes so the UI can reopen the reconnect flow instead of showing a dead generic error.

let lastUrl: string | null = null;
let lastMethod: string | null = null;
let lastHeaders: Record<string, string> | null = null;
let nextResponse: { status: number; body?: unknown } = { status: 204 };

beforeEach(() => {
  lastUrl = null;
  lastMethod = null;
  lastHeaders = null;
  nextResponse = { status: 204 };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    lastUrl = url;
    lastMethod = (init?.method as string) ?? "GET";
    lastHeaders = (init?.headers as Record<string, string>) ?? {};
    return {
      ok: nextResponse.status >= 200 && nextResponse.status < 300,
      status: nextResponse.status,
      statusText: "",
      headers: new Headers(),
      json: async () => nextResponse.body ?? {},
    } as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pinChatMessage", () => {
  it("PUTs the official Helix chat pin endpoint with the chosen duration", async () => {
    const result = await pinChatMessage("19789903", "mod-42", "msg-1", 1800, "tok-1", "client-1");

    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("PUT");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/chat/pins?broadcaster_id=19789903&moderator_id=mod-42&message_id=msg-1&duration_seconds=1800",
    );
    expect(lastHeaders).toMatchObject({
      "Client-Id": "client-1",
      Authorization: "Bearer tok-1",
    });
  });

  it("omits duration_seconds when null so Twitch pins until the stream ends", async () => {
    await pinChatMessage("19789903", "mod-42", "msg-1", null, "tok-1", "client-1");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/chat/pins?broadcaster_id=19789903&moderator_id=mod-42&message_id=msg-1",
    );
  });

  it("classifies a missing-scope 401 and carries moderator:manage:chat_messages", async () => {
    nextResponse = {
      status: 401,
      body: {
        error: "Unauthorized",
        status: 401,
        message: "Missing scope: moderator:manage:chat_messages",
      },
    };

    const result = await pinChatMessage("19789903", "mod-42", "msg-1", 1800, "tok-1", "client-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe("missing-scopes");
      if (result.kind === "missing-scopes") {
        expect(result.missingScopes).toEqual(["moderator:manage:chat_messages"]);
      }
    }
  });

  it("classifies forbidden and not-found Helix responses", async () => {
    nextResponse = { status: 403, body: { message: "not a moderator" } };
    const forbidden = await pinChatMessage("19789903", "mod-42", "msg-1", 1800, "tok-1", "client-1");
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.kind).toBe("forbidden");

    nextResponse = { status: 404, body: { message: "message not found" } };
    const missing = await pinChatMessage("19789903", "mod-42", "msg-1", 1800, "tok-1", "client-1");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.kind).toBe("not-found");
  });
});

describe("unpinChatMessage", () => {
  it("DELETEs the official Helix chat pin endpoint with the chat message id", async () => {
    const result = await unpinChatMessage("19789903", "mod-42", "msg-1", "tok-1", "client-1");

    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe(
      "https://api.twitch.tv/helix/chat/pins?broadcaster_id=19789903&moderator_id=mod-42&message_id=msg-1",
    );
  });
});
