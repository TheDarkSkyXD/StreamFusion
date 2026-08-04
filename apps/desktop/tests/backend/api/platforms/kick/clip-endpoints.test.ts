import Module from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------------------------------------------ *
 * Electron mock: clip-endpoints.ts uses `require("electron")` (CJS)  *
 * inside function bodies. vi.mock only intercepts ESM imports, so we *
 * patch Module.prototype.require to return our mock for "electron".   *
 * ------------------------------------------------------------------ */
const mockNetFetch = vi.fn<(...args: unknown[]) => Promise<Response>>();

const _origRequire = Module.prototype.require;
(Module.prototype as any).require = function (id: string) {
  if (id === "electron") {
    return { net: { fetch: (...args: unknown[]) => mockNetFetch(...args) } };
  }
  return _origRequire.apply(this, [id] as any);
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Guards: Kick clip responses construct the current public page URL instead of trusting legacy media fields
// Guards: Kick clip listing degrades to empty results for missing channels and transport failures
// Guards: Category Clip discovery uses Kick's native Category slug, sort, range, and cursor route.
describe("clip-endpoints — getClipsByChannelSlug", () => {
  let getClipsByChannelSlug: typeof import("@/backend/api/platforms/kick/endpoints/clip-endpoints").getClipsByChannelSlug;
  let getClipsByCategorySlug: typeof import("@/backend/api/platforms/kick/endpoints/clip-endpoints").getClipsByCategorySlug;

  beforeEach(async () => {
    vi.resetModules();
    mockNetFetch.mockReset();
    // Default: return empty clips
    mockNetFetch.mockResolvedValue(jsonResponse({ clips: [] }));
    ({ getClipsByChannelSlug, getClipsByCategorySlug } = await import(
      "@/backend/api/platforms/kick/endpoints/clip-endpoints"
    ));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns mapped clips with correct fields from a well-formed response", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse({
        clips: [
          {
            id: "clip-1",
            title: "Amazing Play",
            duration: 35,
            views: 1200,
            view_count: 1200,
            created_at: "2026-01-15T12:00:00Z",
            video_url: "https://clips.kick.com/clip-1.mp4",
            clip_url: "https://clips.kick.com/clips/a1/clip-1/playlist.m3u8",
            category: { name: "Just Chatting" },
            thumbnail_url: "https://files.kick.com/thumb-clip-1.webp",
            livestream_id: "ls-100",
            channel: { slug: "streamer1" },
          },
        ],
        nextCursor: "abc123",
      })
    );

    const result = await getClipsByChannelSlug("streamer1");

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual({
      id: "clip-1",
      title: "Amazing Play",
      duration: "0:35",
      views: "1200",
      date: expect.any(String),
      created_at: "2026-01-15T12:00:00Z",
      embedUrl: "https://clips.kick.com/clip-1.mp4",
      url: "https://kick.com/streamer1/clips/clip-1",
      shareUrl: "https://kick.com/streamer1/clips/clip-1",
      gameName: "Just Chatting",
      isLive: false,
      thumbnailUrl: "https://files.kick.com/thumb-clip-1.webp",
      vodId: "ls-100",
      channelSlug: "streamer1",
      creatorName: "",
    });
    expect(result.cursor).toBe("abc123");
  });

  it("constructs correct URL with default options", async () => {
    await getClipsByChannelSlug("test-channel");

    expect(mockNetFetch).toHaveBeenCalledTimes(1);
    const url = mockNetFetch.mock.calls[0][0] as string;
    expect(url).toContain("/channels/test-channel/clips");
    expect(url).toContain("cursor=0");
    expect(url).toContain("limit=20");
    expect(url).toContain("sort=date");
  });

  it("maps sort option 'views' to 'view' for Kick API", async () => {
    await getClipsByChannelSlug("test-channel", { sort: "views" });

    const url = mockNetFetch.mock.calls[0][0] as string;
    expect(url).toContain("sort=view");
  });

  it("passes custom limit and cursor options", async () => {
    await getClipsByChannelSlug("test-channel", { limit: 10, cursor: "50" });

    const url = mockNetFetch.mock.calls[0][0] as string;
    expect(url).toContain("cursor=50");
    expect(url).toContain("limit=10");
  });

  it("returns empty data for 404 response", async () => {
    mockNetFetch.mockResolvedValueOnce(new Response("", { status: 404 }));

    const result = await getClipsByChannelSlug("nonexistent");

    expect(result).toEqual({ data: [] });
  });

  it("returns empty data when fetch throws", async () => {
    mockNetFetch.mockRejectedValueOnce(new Error("net::ERR_FAILED"));

    const result = await getClipsByChannelSlug("dead-channel");

    expect(result).toEqual({ data: [] });
  });

  it("returns empty data on non-ok non-404 status", async () => {
    mockNetFetch.mockResolvedValueOnce(new Response("", { status: 500 }));

    const result = await getClipsByChannelSlug("error-channel");

    expect(result).toEqual({ data: [] });
  });

  it("returns undefined cursor when nextCursor is absent", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse({
        clips: [
          {
            id: "c1",
            title: "t",
            duration: 10,
            views: 0,
            created_at: "2026-01-01T00:00:00Z",
            video_url: "",
            clip_url: "",
            category: null,
            thumbnail_url: "",
          },
        ],
      })
    );

    const result = await getClipsByChannelSlug("no-cursor-channel");

    expect(result.cursor).toBeUndefined();
  });

  it("handles clips with missing optional fields gracefully", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse({
        clips: [
          {
            id: "clip-sparse",
            title: "Sparse",
            duration: 0,
            created_at: "2026-01-01T00:00:00Z",
            video_url: "",
            clip_url: "",
            category: null,
            thumbnail_url: "",
          },
        ],
      })
    );

    const result = await getClipsByChannelSlug("sparse-channel");

    expect(result.data[0].duration).toBe("0:00");
    expect(result.data[0].views).toBe("0");
    expect(result.data[0].gameName).toBe("Unknown");
    expect(result.data[0].vodId).toBe("");
    expect(result.data[0].channelSlug).toBe("");
  });

  it("formats multi-minute durations correctly", async () => {
    mockNetFetch.mockResolvedValueOnce(
      jsonResponse({
        clips: [
          {
            id: "c",
            title: "t",
            duration: 125,
            views: 0,
            created_at: "2026-01-01T00:00:00Z",
            video_url: "",
            clip_url: "",
            category: null,
            thumbnail_url: "",
          },
        ],
      })
    );

    const result = await getClipsByChannelSlug("duration-channel");

    expect(result.data[0].duration).toBe("2:05");
  });

  it("sends request headers including User-Agent and Accept", async () => {
    await getClipsByChannelSlug("headers-test");

    const options = mockNetFetch.mock.calls[0][1] as Record<string, unknown>;
    const headers = options.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json");
    expect(headers["User-Agent"]).toContain("Mozilla");
  });

  it("sends AbortSignal.timeout for request timeout", async () => {
    await getClipsByChannelSlug("timeout-test");

    const options = mockNetFetch.mock.calls[0][1] as Record<string, unknown>;
    expect(options.signal).toBeDefined();
  });

  it("requests native Category Clips with the selected sort, range, and cursor", async () => {
    await getClipsByCategorySlug("just-chatting", {
      limit: 20,
      cursor: "next-page",
      sort: "views",
      timeRange: "week",
    });

    expect(mockNetFetch).toHaveBeenCalledTimes(1);
    expect(mockNetFetch.mock.calls[0][0]).toBe(
      "https://kick.com/api/v2/categories/just-chatting/clips?cursor=next-page&limit=20&sort=view&time=week"
    );
  });

  it("rejects Category Clip transport failures so IPC can distinguish unavailable from empty", async () => {
    mockNetFetch.mockResolvedValueOnce(new Response("", { status: 503 }));

    await expect(getClipsByCategorySlug("just-chatting")).rejects.toThrow("Status 503");
  });
});
