import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadURL = vi.fn<(...args: unknown[]) => Promise<void>>();
const mockExecuteJavaScript = vi.fn<(...args: unknown[]) => Promise<string>>();
const mockDestroy = vi.fn();
const mockIsDestroyed = vi.fn(() => false);

vi.mock("electron", () => ({
  BrowserWindow: function BrowserWindow() {
    return {
      loadURL: (...args: unknown[]) => mockLoadURL(...args),
      webContents: { executeJavaScript: (...args: unknown[]) => mockExecuteJavaScript(...args) },
      destroy: () => mockDestroy(),
      isDestroyed: () => mockIsDestroyed(),
      title: "",
    };
  },
}));

vi.mock("@/backend/api/unified/platform-health", () => ({
  isPlatformHealthy: vi.fn(() => true),
  recordPlatformFailure: vi.fn(),
  recordPlatformSuccess: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/endpoints/channel-endpoints", () => ({
  acquireBrowserWindowSlot: vi.fn(async () => vi.fn()),
}));

import { getKickChannelHistory } from "@/backend/api/platforms/kick/endpoints/chat-endpoints";
import { isPlatformHealthy } from "@/backend/api/unified/platform-health";

describe("chat-endpoints -- getKickChannelHistory", () => {
  beforeEach(() => {
    mockLoadURL.mockReset().mockResolvedValue(undefined);
    mockExecuteJavaScript.mockReset();
    mockDestroy.mockReset();
    mockIsDestroyed.mockReset().mockReturnValue(false);
    vi.mocked(isPlatformHealthy).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for empty channelId", async () => {
    const result = await getKickChannelHistory("");

    expect(result).toBeNull();
  });

  it("returns null when platform is not healthy", async () => {
    vi.mocked(isPlatformHealthy).mockReturnValue(false);

    const result = await getKickChannelHistory("12345");

    expect(result).toBeNull();
  });

  it("returns messages and pinned message from a well-formed response", async () => {
    const messages = [
      {
        id: "msg-1",
        chatroom_id: 100,
        content: "Hello!",
        type: "message",
        created_at: "2026-01-15T12:00:00Z",
        sender: {
          id: 1,
          username: "User1",
          slug: "user1",
          identity: { color: "#FF0000", badges: [] },
        },
        metadata: null,
      },
    ];
    const pinnedMessage = {
      id: "pin-1",
      content: "Pinned!",
      sender: { id: 2, username: "Mod" },
    };

    mockExecuteJavaScript.mockResolvedValueOnce(
      JSON.stringify({ data: { messages, pinned_message: pinnedMessage } })
    );

    const result = await getKickChannelHistory("12345");

    expect(result).not.toBeNull();
    expect(result!.messages).toEqual(messages);
    expect(result!.pinnedMessage).toEqual(pinnedMessage);
  });

  it("returns empty messages array when data.messages is absent", async () => {
    mockExecuteJavaScript.mockResolvedValueOnce(JSON.stringify({ data: {} }));

    const result = await getKickChannelHistory("12345");

    expect(result).not.toBeNull();
    expect(result!.messages).toEqual([]);
    expect(result!.pinnedMessage).toBeNull();
  });

  it("returns null when page content is empty", async () => {
    mockExecuteJavaScript.mockResolvedValueOnce("");

    const result = await getKickChannelHistory("12345");

    expect(result).toBeNull();
  });

  it("returns null when page content is invalid JSON", async () => {
    mockExecuteJavaScript.mockResolvedValueOnce("not json at all");

    const result = await getKickChannelHistory("12345");

    expect(result).toBeNull();
  });

  it("returns null when page contains server error text", async () => {
    const errorTexts = [
      "Error Code 500 - Internal Server Error",
      "bad gateway",
      "service unavailable",
    ];

    for (const text of errorTexts) {
      mockExecuteJavaScript.mockResolvedValueOnce(text);

      const result = await getKickChannelHistory("12345");

      expect(result).toBeNull();
    }
  });

  it("returns null when loadURL throws (network/timeout error)", async () => {
    mockLoadURL.mockRejectedValueOnce(new Error("Page load timeout"));

    const result = await getKickChannelHistory("12345");

    expect(result).toBeNull();
  });

  it("destroys the BrowserWindow in the finally block", async () => {
    mockExecuteJavaScript.mockResolvedValueOnce(
      JSON.stringify({ data: { messages: [] } })
    );

    await getKickChannelHistory("12345");

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("does not throw when window is already destroyed in finally", async () => {
    mockIsDestroyed.mockReturnValue(true);
    mockExecuteJavaScript.mockResolvedValueOnce(
      JSON.stringify({ data: { messages: [] } })
    );

    await expect(getKickChannelHistory("12345")).resolves.not.toThrow();
  });

  it("returns null when platform becomes unhealthy after acquiring slot", async () => {
    vi.mocked(isPlatformHealthy)
      .mockReturnValueOnce(true) // First check passes
      .mockReturnValueOnce(false); // Second check (post-slot) fails

    const result = await getKickChannelHistory("12345");

    expect(result).toBeNull();
  });

  it("constructs URL with encoded channelId", async () => {
    mockExecuteJavaScript.mockResolvedValueOnce(
      JSON.stringify({ data: { messages: [] } })
    );

    await getKickChannelHistory("123/456");

    expect(mockLoadURL).toHaveBeenCalledWith(
      expect.stringContaining("123%2F456")
    );
  });
});
