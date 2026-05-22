import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pusher-js is loaded at module-init time by kick-chat.ts but only used inside
// connect() / joinChannel(). These tests bypass those paths by populating the
// internal channels map directly, so a no-op mock is enough to import the file.
vi.mock("pusher-js", () => ({
  default: vi.fn(),
}));

import { KickChatService } from "@/backend/services/chat/kick-chat";

// Guards: kick-chat sendMessage wire format — POST /public/v1/chat must carry the
// broadcaster's user_id (channel data.id), NOT the chatroom id used for Pusher.
// These are two distinct numeric ids on Kick; swapping them or falling back to
// chatroomId reintroduces the pre-306a8e5 bug where Kick rejects every send.
// Guards: 401 must surface a user-actionable message naming the recovery path
// (disconnect/reconnect Kick), not a bare "401 Unauthorized" — without that hint
// existing users hit by the chat:write scope rollout have no way to recover.

interface InternalChannelInfo {
  slug: string;
  chatroomId: number;
  broadcasterUserId?: number;
}

interface ServiceInternals {
  accessToken: string | null;
  channels: Map<string, InternalChannelInfo>;
}

function makeService(): { service: KickChatService; internals: ServiceInternals } {
  const service = new KickChatService();
  const internals = service as unknown as ServiceInternals;
  internals.accessToken = "test-bearer";
  return { service, internals };
}

describe("KickChatService.sendMessage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve(new Response('{"data":{}}', { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts broadcaster_user_id from broadcasterUserId, not chatroomId", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111, // Pusher chatroom id
      broadcasterUserId: 42, // Broadcaster's user_id (different number)
    });

    await service.sendMessage("ac7ionman", "hello");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.broadcaster_user_id).toBe(42);
    expect(body.broadcaster_user_id).not.toBe(999_111);
    expect(body.content).toBe("hello");
    expect(body.type).toBe("user");
  });

  it("throws an actionable reconnect message on 401 (chat:write scope missing)", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    fetchMock.mockResolvedValueOnce(
      new Response('{"message":"Unauthorized"}', { status: 401 }),
    );

    await expect(service.sendMessage("ac7ionman", "hi")).rejects.toThrow(
      /disconnect and reconnect/i,
    );
  });

  it("throws (without calling fetch) when broadcasterUserId is missing on the channel record", async () => {
    const { service, internals } = makeService();
    internals.channels.set("receive-only", {
      slug: "receive-only",
      chatroomId: 555,
      // broadcasterUserId intentionally absent — the channelId-still-resolving
      // case where join succeeded but send must not silently use chatroomId.
    });

    await expect(service.sendMessage("receive-only", "hi")).rejects.toThrow(
      /broadcaster user_id not set/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
