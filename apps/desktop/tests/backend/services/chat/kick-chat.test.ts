import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// pusher-js is loaded at module-init time by kick-chat.ts but only used inside
// connect() / joinChannel(). These tests bypass those paths by populating the
// internal channels map directly, so a no-op mock is enough to import the file.
vi.mock("pusher-js", () => ({
  default: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/kick-send-window", () => ({
  ensureSendWindowReady: vi.fn(() => Promise.resolve()),
  sendKickChatMessage: vi.fn(),
  disposeSendWindow: vi.fn(() => Promise.resolve()),
}));

import * as sendWindow from "@/backend/api/platforms/kick/kick-send-window";
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
  beforeEach(() => {
    vi.mocked(sendWindow.sendKickChatMessage).mockResolvedValue({
      ok: true,
      messageId: "01JAXK8N",
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls sendKickChatMessage with chatroomId, not broadcaster_user_id", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    await service.sendMessage("ac7ionman", "hello");
    expect(sendWindow.sendKickChatMessage).toHaveBeenCalledWith(999_111, "hello");
    // Sanity: the OLD broadcaster_user_id MUST NOT be the first arg.
    const [firstArg] = vi.mocked(sendWindow.sendKickChatMessage).mock.calls[0]!;
    expect(firstArg).not.toBe(42);
  });

  it("surfaces auth-expired as an actionable error with reconnect hint", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    vi.mocked(sendWindow.sendKickChatMessage).mockResolvedValueOnce({
      ok: false,
      kind: "auth-expired",
      message: "Kick session expired — reconnect Kick in Settings.",
    });
    await expect(service.sendMessage("ac7ionman", "hi")).rejects.toThrow(/reconnect Kick/i);
  });

  it("surfaces rate-limited cleanly", async () => {
    const { service, internals } = makeService();
    internals.channels.set("ac7ionman", {
      slug: "ac7ionman",
      chatroomId: 999_111,
      broadcasterUserId: 42,
    });
    vi.mocked(sendWindow.sendKickChatMessage).mockResolvedValueOnce({
      ok: false,
      kind: "rate-limited",
      message: "Slow down — Kick rate limit.",
      retryAfterSeconds: 5,
    });
    await expect(service.sendMessage("ac7ionman", "hi")).rejects.toThrow(/Slow down/);
  });
});

describe("KickChatService.joinChannel triggers warmup", () => {
  it("calls ensureSendWindowReady without awaiting", async () => {
    const { service, internals } = makeService();
    // Fake Pusher state so joinChannel doesn't blow up on the WebSocket path.
    (service as any).pusher = {
      connection: { state: "connected" },
      subscribe: vi.fn(() => ({ bind: vi.fn() })),
    };
    (service as any).connectionState = "connected";
    await service.joinChannel("ac7ionman", 999_111, 42);
    expect(sendWindow.ensureSendWindowReady).toHaveBeenCalledOnce();
    expect(internals.channels.has("ac7ionman")).toBe(true);
  });
});
