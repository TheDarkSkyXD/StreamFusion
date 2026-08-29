import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLoadURL = vi.fn<(...args: unknown[]) => Promise<void>>();
const mockExecuteJavaScript = vi.fn<(...args: unknown[]) => Promise<string>>();
const mockWebContentsOnce = vi.fn<(event: string, listener: () => void) => void>();
const mockWebContentsRemoveListener = vi.fn<(event: string, listener: () => void) => void>();
const mockDestroy = vi.fn();
const mockIsDestroyed = vi.fn(() => false);
const mockSessionFetch = vi.fn();

vi.mock("electron", () => ({
  BrowserWindow: function BrowserWindow() {
    return {
      loadURL: (...args: unknown[]) => mockLoadURL(...args),
      webContents: {
        executeJavaScript: (...args: unknown[]) => mockExecuteJavaScript(...args),
        once: (event: string, listener: () => void) => mockWebContentsOnce(event, listener),
        removeListener: (event: string, listener: () => void) =>
          mockWebContentsRemoveListener(event, listener),
      },
      destroy: () => mockDestroy(),
      isDestroyed: () => mockIsDestroyed(),
      title: "",
    };
  },
  session: {
    fromPartition: vi.fn(() => ({ fetch: mockSessionFetch })),
  },
}));

vi.mock("@backend/api/unified/platform-health", () => ({
  getPlatformHealth: vi.fn(() => "healthy"),
  isPlatformHealthy: vi.fn(() => true),
  recordPlatformFailure: vi.fn(),
  recordPlatformSuccess: vi.fn(),
}));

vi.mock("@backend/api/platforms/kick/endpoints/channel-endpoints", () => ({
  acquireBrowserWindowSlot: vi.fn(async () => vi.fn()),
}));

import { getKickChannelHistory } from "@backend/api/platforms/kick/endpoints/chat-endpoints";
import { getPlatformHealth, isPlatformHealthy } from "@backend/api/unified/platform-health";

// Guards: Kick history uses a direct cookie-bearing session request first, then a normal channel page when Kick rejects the lightweight request.
// Guards: a non-successful in-page history response must return unavailable instead of being mistaken for empty history.
// Guards: history fetching must begin at DOM readiness because Kick's SPA can remain in a loading state past the navigation deadline.
describe("chat-endpoints -- getKickChannelHistory", () => {
  beforeEach(() => {
    mockLoadURL.mockReset().mockResolvedValue(undefined);
    mockExecuteJavaScript.mockReset();
    mockWebContentsOnce.mockReset();
    mockWebContentsRemoveListener.mockReset();
    mockDestroy.mockReset();
    mockIsDestroyed.mockReset().mockReturnValue(false);
    mockSessionFetch.mockReset().mockRejectedValue(new Error("direct session blocked"));
    vi.mocked(getPlatformHealth).mockReturnValue("healthy");
    vi.mocked(isPlatformHealthy).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns direct session history without constructing a hidden channel window", async () => {
    mockSessionFetch.mockResolvedValue(
      new Response(JSON.stringify({ data: { messages: [], pinned_message: null } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await getKickChannelHistory("12345", "xqc");

    expect(result).toEqual({ messages: [], pinnedMessage: null });
    expect(mockSessionFetch).toHaveBeenCalledWith(
      "https://kick.com/api/v2/channels/12345/messages",
      expect.objectContaining({ credentials: "include" })
    );
    expect(mockLoadURL).not.toHaveBeenCalled();
  });

  it("loads the channel page before fetching history from Kick's web API with credentials", async () => {
    mockExecuteJavaScript.mockResolvedValueOnce(
      JSON.stringify({ ok: true, body: { data: { messages: [] } } })
    );

    const result = await getKickChannelHistory("12345", "xqc");

    expect(result).toEqual({ messages: [], pinnedMessage: null });
    expect(mockLoadURL).toHaveBeenCalledWith("https://kick.com/xqc");
    expect(mockExecuteJavaScript).toHaveBeenCalledWith(
      expect.stringMatching(
        /fetch\([^]*\/api\/v2\/channels\/12345\/messages[^]*credentials:\s*["']include["']/
      )
    );
  });

  it("fetches history when the channel DOM is ready even if the full page load stays pending", async () => {
    mockLoadURL.mockReturnValueOnce(new Promise<void>(() => undefined));
    mockWebContentsOnce.mockImplementationOnce((event, listener) => {
      if (event === "dom-ready") queueMicrotask(listener);
    });
    mockExecuteJavaScript.mockResolvedValueOnce(
      JSON.stringify({ ok: true, body: { data: { messages: [] } } })
    );

    const result = await getKickChannelHistory("12345", "xqc");

    expect(result).toEqual({ messages: [], pinnedMessage: null });
    expect(mockExecuteJavaScript).toHaveBeenCalledTimes(1);
  });

  it("returns null when the credentialed history request is not successful", async () => {
    mockExecuteJavaScript.mockResolvedValueOnce(
      JSON.stringify({ ok: false, status: 403, body: null })
    );

    const result = await getKickChannelHistory("12345", "xqc");

    expect(result).toBeNull();
  });

  it("returns null for empty channelId", async () => {
    const result = await getKickChannelHistory("");

    expect(result).toBeNull();
  });

  it("returns null when platform is down", async () => {
    vi.mocked(getPlatformHealth).mockReturnValue("down");

    const result = await getKickChannelHistory("12345");

    expect(result).toBeNull();
    expect(mockLoadURL).not.toHaveBeenCalled();
  });

  it("still attempts history when platform is degraded", async () => {
    vi.mocked(getPlatformHealth).mockReturnValue("degraded");
    mockExecuteJavaScript.mockResolvedValueOnce(JSON.stringify({ data: { messages: [] } }));

    const result = await getKickChannelHistory("12345");

    expect(result).not.toBeNull();
    expect(mockLoadURL).toHaveBeenCalled();
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
    mockExecuteJavaScript.mockResolvedValueOnce(JSON.stringify({ data: { messages: [] } }));

    await getKickChannelHistory("12345");

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("does not throw when window is already destroyed in finally", async () => {
    mockIsDestroyed.mockReturnValue(true);
    mockExecuteJavaScript.mockResolvedValueOnce(JSON.stringify({ data: { messages: [] } }));

    await expect(getKickChannelHistory("12345")).resolves.not.toThrow();
  });

  it("returns null when platform becomes unhealthy after acquiring slot", async () => {
    vi.mocked(getPlatformHealth)
      .mockReturnValueOnce("healthy") // First check passes
      .mockReturnValueOnce("down"); // Second check (post-slot) fails

    const result = await getKickChannelHistory("12345");

    expect(result).toBeNull();
  });

  it("encodes the channel id in the web history path", async () => {
    mockExecuteJavaScript.mockResolvedValueOnce(JSON.stringify({ data: { messages: [] } }));

    await getKickChannelHistory("123/456", "xqc");

    expect(mockExecuteJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("/api/v2/channels/123%2F456/messages")
    );
  });
});
