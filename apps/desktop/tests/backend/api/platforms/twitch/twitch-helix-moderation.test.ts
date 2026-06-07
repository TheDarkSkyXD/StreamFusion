import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
  const jsonMock = vi.fn();
  const getMock = vi.fn(() => ({ json: jsonMock }));
  return {
    api: { get: getMock },
    __jsonMock: jsonMock,
    __getMock: getMock,
  };
});

vi.mock("@/lib/cross-logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { getModeratedChannels } from "@/backend/api/platforms/twitch/twitch-helix-moderation";
import { api } from "@/lib/api-client";

const getMock = (api as any).get as ReturnType<typeof vi.fn>;

describe("getModeratedChannels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns channels from a single page (no pagination cursor)", async () => {
    const channel = {
      broadcaster_id: "100",
      broadcaster_login: "streamer",
      broadcaster_name: "Streamer",
    };
    const jsonMock = vi.fn().mockResolvedValueOnce({
      data: [channel],
      pagination: {},
    });
    getMock.mockReturnValue({ json: jsonMock });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(result).toEqual([channel]);
    expect(getMock).toHaveBeenCalledTimes(1);
    const url = getMock.mock.calls[0][0] as string;
    expect(url).toContain("user_id=user1");
    expect(url).toContain("first=100");
  });

  it("follows pagination cursor across pages", async () => {
    const ch1 = { broadcaster_id: "1", broadcaster_login: "a", broadcaster_name: "A" };
    const ch2 = { broadcaster_id: "2", broadcaster_login: "b", broadcaster_name: "B" };

    const jsonMock = vi
      .fn()
      .mockResolvedValueOnce({ data: [ch1], pagination: { cursor: "page2" } })
      .mockResolvedValueOnce({ data: [ch2], pagination: {} });
    getMock.mockReturnValue({ json: jsonMock });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(result).toEqual([ch1, ch2]);
    expect(jsonMock).toHaveBeenCalledTimes(2);
    const secondUrl = getMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain("after=page2");
  });

  it("returns empty array when API throws (auth failure)", async () => {
    const jsonMock = vi.fn().mockRejectedValueOnce(new Error("401 Unauthorized"));
    getMock.mockReturnValue({ json: jsonMock });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(result).toEqual([]);
  });

  it("returns empty array when body has no data", async () => {
    const jsonMock = vi.fn().mockResolvedValueOnce({ pagination: {} });
    getMock.mockReturnValue({ json: jsonMock });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(result).toEqual([]);
  });

  it("returns null body gracefully", async () => {
    const jsonMock = vi.fn().mockResolvedValueOnce(null);
    getMock.mockReturnValue({ json: jsonMock });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(result).toEqual([]);
  });

  it("sends correct headers", async () => {
    const jsonMock = vi.fn().mockResolvedValueOnce({ data: [], pagination: {} });
    getMock.mockReturnValue({ json: jsonMock });

    await getModeratedChannels("user1", "mytoken", "myclient");

    const options = getMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(options.headers["Client-ID"]).toBe("myclient");
    expect(options.headers.Authorization).toBe("Bearer mytoken");
  });

  it("hard-caps at 50 pages to prevent infinite loops", async () => {
    const ch = { broadcaster_id: "x", broadcaster_login: "x", broadcaster_name: "X" };
    const jsonMock = vi.fn().mockResolvedValue({
      data: [ch],
      pagination: { cursor: "forever" },
    });
    getMock.mockReturnValue({ json: jsonMock });

    const result = await getModeratedChannels("user1", "tok", "cid");

    expect(jsonMock).toHaveBeenCalledTimes(50);
    expect(result).toHaveLength(50);
  });
});
