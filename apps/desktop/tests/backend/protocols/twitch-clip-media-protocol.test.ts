import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
}));

import { handleTwitchClipMediaRequest } from "@/backend/protocols/twitch-clip-media-protocol";
import { buildTwitchClipMediaUrl } from "@/backend/protocols/twitch-clip-media-url";

describe("twitch clip media protocol", () => {
  it("forwards Range and returns a byte-backed 206 response with media headers", async () => {
    const originalUrl =
      "https://d1ndex63qxojbr.cloudfront.net/nauth/clip/landscape/h264/1080/index.mp4?sig=s&token=t";
    const request = new Request(buildTwitchClipMediaUrl(originalUrl), {
      headers: {
        range: "bytes=0-3",
      },
    });
    const fetchClipMedia = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "4",
          "Content-Range": "bytes 0-3/100",
          "Content-Type": "video/mp4",
        },
      })
    );

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(fetchClipMedia).toHaveBeenCalledWith(
      originalUrl,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
          Origin: "https://clips.twitch.tv",
          Range: "bytes=0-3",
          Referer: "https://clips.twitch.tv/",
        }),
      })
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-3/100");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("rejects non-Twitch clip media URLs before fetching", async () => {
    const request = new Request(buildTwitchClipMediaUrl("https://example.com/clip.mp4"));
    const fetchClipMedia = vi.fn();

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(response.status).toBe(400);
    expect(fetchClipMedia).not.toHaveBeenCalled();
  });

  it("defaults successful clip responses to mp4 with a byte-length content length", async () => {
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4")
    );
    const fetchClipMedia = vi.fn().mockResolvedValue(new Response(new Uint8Array([9, 8, 7])));

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("3");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
  });
});
