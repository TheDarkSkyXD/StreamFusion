import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchKickWebApiMutationMock = vi.hoisted(() => vi.fn());

vi.mock("@/backend/api/platforms/kick/kick-send-window", () => ({
  fetchKickWebApiMutation: fetchKickWebApiMutationMock,
}));

import {
  pinKickMessage,
  unpinKickMessage,
} from "@/backend/api/platforms/kick/kick-pin-mutations";

// Guards: Kick pin/unpin v2 wire envelope runs through the main-process Kick web session, not renderer/OAuth fetch, because the legacy `/api/v2/channels/{slug}/pinned-message` route returns 401 to OAuth bearer tokens.
// Guards: result classification keeps unauthenticated/forbidden/not-found/network stable for the UI toast and retry behavior.
describe("kick-pin-mutations", () => {
  beforeEach(() => {
    fetchKickWebApiMutationMock.mockReset();
    fetchKickWebApiMutationMock.mockResolvedValue({ ok: true, status: 200, body: "{}" });
  });

  it("POSTs to /api/v2/channels/{slug}/pinned-message with the canonical message envelope", async () => {
    const result = await pinKickMessage({
      channelSlug: "ac7ionman",
      messageId: "msg-1",
      chatroomId: 12345,
      content: "hello",
      sender: { id: 99, username: "ac7ionman", slug: "ac7ionman" },
      durationSeconds: 1200,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchKickWebApiMutationMock).toHaveBeenCalledWith(
      "POST",
      "/api/v2/channels/ac7ionman/pinned-message",
      expect.objectContaining({
        duration: 1200,
        message: expect.objectContaining({
          id: "msg-1",
          chatroom_id: 12345,
          content: "hello",
          type: "message",
          sender: { id: 99, username: "ac7ionman", slug: "ac7ionman" },
        }),
      })
    );
  });

  it("omits the duration field when durationSeconds is null (until-unpinned)", async () => {
    await pinKickMessage({
      channelSlug: "ac7ionman",
      messageId: "msg-1",
      chatroomId: 12345,
      content: "hello",
      sender: { id: 99, username: "ac7ionman" },
      durationSeconds: null,
    });

    expect(fetchKickWebApiMutationMock.mock.calls[0][2]).not.toHaveProperty("duration");
  });

  it("classifies an auth-expired web-session result as unauthenticated", async () => {
    fetchKickWebApiMutationMock.mockResolvedValue({
      ok: false,
      kind: "auth-expired",
      status: 401,
      body: "{}",
      message: "Kick session expired",
    });

    const result = await pinKickMessage({
      channelSlug: "ac7ionman",
      messageId: "msg-1",
      chatroomId: 12345,
      content: "hi",
      sender: { id: 99, username: "ac7ionman" },
      durationSeconds: 1200,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("unauthenticated");
  });

  it("classifies a 403 as forbidden", async () => {
    fetchKickWebApiMutationMock.mockResolvedValue({
      ok: false,
      kind: "unknown",
      status: 403,
      body: "{}",
      message: "Forbidden",
    });

    const result = await pinKickMessage({
      channelSlug: "ac7ionman",
      messageId: "msg-1",
      chatroomId: 12345,
      content: "hi",
      sender: { id: 99, username: "ac7ionman" },
      durationSeconds: 1200,
    });

    if (!result.ok) expect(result.kind).toBe("forbidden");
    else throw new Error("expected forbidden");
  });

  it("DELETEs /api/v2/channels/{slug}/pinned-message", async () => {
    const result = await unpinKickMessage("ac7ionman");

    expect(result).toEqual({ ok: true });
    expect(fetchKickWebApiMutationMock).toHaveBeenCalledWith(
      "DELETE",
      "/api/v2/channels/ac7ionman/pinned-message"
    );
  });

  it("classifies a 404 as not-found", async () => {
    fetchKickWebApiMutationMock.mockResolvedValue({
      ok: false,
      kind: "unknown",
      status: 404,
      body: "{}",
      message: "Not found",
    });

    const result = await unpinKickMessage("ac7ionman");
    if (!result.ok) expect(result.kind).toBe("not-found");
    else throw new Error("expected not-found");
  });
});
