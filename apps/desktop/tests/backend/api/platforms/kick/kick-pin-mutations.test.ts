import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pinKickMessage,
  unpinKickMessage,
} from "@/backend/api/platforms/kick/kick-pin-mutations";

let lastUrl = "";
let lastBody: unknown = null;
let lastMethod = "";
let nextResponse: { status: number; body: unknown } = { status: 200, body: { ok: true } };

beforeEach(() => {
  lastUrl = "";
  lastBody = null;
  lastMethod = "";
  nextResponse = { status: 200, body: { ok: true } };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    lastUrl = url;
    lastMethod = init?.method || "GET";
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

describe("pinKickMessage", () => {
  it("POSTs to /api/v2/channels/{slug}/pinned-message with the canonical message envelope", async () => {
    const result = await pinKickMessage({
      channelSlug: "ac7ionman",
      messageId: "msg-1",
      chatroomId: 12345,
      content: "hello",
      sender: { id: 99, username: "ac7ionman", slug: "ac7ionman" },
      durationSeconds: 1200,
      accessToken: "tok-1",
    });

    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("POST");
    expect(lastUrl).toBe("https://kick.com/api/v2/channels/ac7ionman/pinned-message");
    expect(lastBody).toMatchObject({
      duration: 1200,
      message: {
        id: "msg-1",
        chatroom_id: 12345,
        content: "hello",
        type: "message",
        sender: { id: 99, username: "ac7ionman" },
      },
    });
  });

  it("omits the duration field when durationSeconds is null (until-unpinned)", async () => {
    await pinKickMessage({
      channelSlug: "ac7ionman",
      messageId: "msg-1",
      chatroomId: 12345,
      content: "hello",
      sender: { id: 99, username: "ac7ionman" },
      durationSeconds: null,
      accessToken: "tok-1",
    });
    expect(lastBody).not.toHaveProperty("duration");
  });

  it("classifies a 401 as unauthenticated", async () => {
    nextResponse = { status: 401, body: { message: "Unauthorized" } };
    const result = await pinKickMessage({
      channelSlug: "ac7ionman",
      messageId: "msg-1",
      chatroomId: 12345,
      content: "hi",
      sender: { id: 99, username: "ac7ionman" },
      durationSeconds: 1200,
      accessToken: "tok-1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unauthenticated");
  });

  it("classifies a 403 as forbidden", async () => {
    nextResponse = { status: 403, body: { message: "Forbidden" } };
    const result = await pinKickMessage({
      channelSlug: "ac7ionman",
      messageId: "msg-1",
      chatroomId: 12345,
      content: "hi",
      sender: { id: 99, username: "ac7ionman" },
      durationSeconds: 1200,
      accessToken: "tok-1",
    });
    if (!result.ok) expect(result.kind).toBe("forbidden");
    else throw new Error("expected forbidden");
  });
});

describe("unpinKickMessage", () => {
  it("DELETEs /api/v2/channels/{slug}/pinned-message", async () => {
    const result = await unpinKickMessage("ac7ionman", "tok-1");
    expect(result).toEqual({ ok: true });
    expect(lastMethod).toBe("DELETE");
    expect(lastUrl).toBe("https://kick.com/api/v2/channels/ac7ionman/pinned-message");
  });

  it("classifies a 404 as not-found", async () => {
    nextResponse = { status: 404, body: { message: "Not Found" } };
    const result = await unpinKickMessage("ac7ionman", "tok-1");
    if (!result.ok) expect(result.kind).toBe("not-found");
    else throw new Error("expected not-found");
  });
});
