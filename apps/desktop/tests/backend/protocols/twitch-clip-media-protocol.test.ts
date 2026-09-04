import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn() },
}));

import {
  handleTwitchClipMediaRequest,
  TWITCH_CLIP_MEDIA_SCHEME_PRIVILEGES,
} from "@backend/protocols/twitch-clip-media-protocol";
import { buildTwitchClipMediaUrl } from "@backend/protocols/twitch-clip-media-url";

// Guards: clip playback can consume the first upstream bytes before the media response reaches EOF
// Guards: Range requests preserve upstream partial-response status, metadata, and bytes
// Guards: unsatisfiable Range responses preserve upstream status, metadata, and body
// Guards: closing clip media aborts the fetch and cancels the upstream body without draining it
// Guards: clip media reads pull upstream only as Chromium consumes the downstream body
// Guards: signed clip media is never cached by the downstream response
// Guards: upstream clip requests avoid synthetic Origin and Referer context that Electron rejects for signed CDN media
// Guards: malformed upstream content lengths are not forwarded to Chromium
// Guards: upstream responses with no body preserve their status without becoming synthetic failures
// Guards: upstream body failures after partial delivery reach the downstream reader without hiding prior bytes
// Guards: upstream fetch failures become non-cacheable gateway responses
// Guards: upstream HTTP failures preserve their response without inventing media metadata
// Guards: untrusted clip media hosts are rejected before any network request
// Guards: successful streaming responses retain a usable media type without inventing a length
// Guards: localhost media requests can cross into the custom streaming scheme under Chromium CORS
describe("twitch clip media protocol", () => {
  it("registers the custom media scheme for CORS-enabled streaming", () => {
    expect(TWITCH_CLIP_MEDIA_SCHEME_PRIVILEGES).toEqual(
      expect.objectContaining({
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      })
    );
  });

  it("returns the media response and first chunk before upstream EOF", async () => {
    let closeUpstream!: () => void;
    let upstreamClosed = false;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
        closeUpstream = () => {
          controller.close();
          upstreamClosed = true;
        };
      },
    });
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4")
    );
    const fetchClipMedia = vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        headers: {
          "Content-Type": "video/mp4",
        },
      })
    );

    const responsePromise = handleTwitchClipMediaRequest(request, fetchClipMedia);
    let handlerReadyBeforeEof = false;
    void responsePromise.then(() => {
      handlerReadyBeforeEof = true;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const observedHandlerReadyBeforeEof = handlerReadyBeforeEof;
    if (!handlerReadyBeforeEof) closeUpstream();

    const response = await responsePromise;
    const reader = response.body!.getReader();
    const firstRead = await reader.read();
    if (!upstreamClosed) closeUpstream();
    await reader.cancel();

    expect(observedHandlerReadyBeforeEof).toBe(true);
    expect(firstRead).toEqual({ done: false, value: new Uint8Array([1, 2, 3, 4]) });
  });

  it("forwards Range and returns a streamed 206 response with safe media headers", async () => {
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
          ETag: '"clip-etag"',
          "Last-Modified": "Wed, 05 Aug 2026 20:00:00 GMT",
          "Set-Cookie": "signed-secret=do-not-forward",
          "X-Signed-Token": "do-not-forward",
        },
      })
    );

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(fetchClipMedia).toHaveBeenCalledWith(
      originalUrl,
      expect.objectContaining({
        method: "GET",
        headers: {
          Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8",
          Range: "bytes=0-3",
        },
        signal: request.signal,
        cache: "no-store",
        redirect: "follow",
      })
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe("4");
    expect(response.headers.get("Content-Range")).toBe("bytes 0-3/100");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("ETag")).toBe('"clip-etag"');
    expect(response.headers.get("Last-Modified")).toBe("Wed, 05 Aug 2026 20:00:00 GMT");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("X-Signed-Token")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("preserves an upstream 416 Range response", async () => {
    const originalUrl = "https://clips-media-assets2.twitch.tv/example.mp4";
    const request = new Request(buildTwitchClipMediaUrl(originalUrl), {
      headers: {
        range: "bytes=100-199",
      },
    });
    const fetchClipMedia = vi.fn().mockResolvedValue(
      new Response("range not satisfiable", {
        status: 416,
        statusText: "Range Not Satisfiable",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "21",
          "Content-Range": "bytes */100",
          "Content-Type": "text/plain",
        },
      })
    );

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(response.status).toBe(416);
    expect(response.statusText).toBe("Range Not Satisfiable");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe("21");
    expect(response.headers.get("Content-Range")).toBe("bytes */100");
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(await response.text()).toBe("range not satisfiable");
  });

  it("propagates downstream cancellation to the upstream request and body", async () => {
    const abortController = new AbortController();
    let cancelReason: unknown;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4"),
      { signal: abortController.signal }
    );
    const fetchClipMedia = vi.fn().mockResolvedValue(new Response(upstreamBody));

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel("superseded seek");

    expect(cancelReason).toBe("superseded seek");
  });

  it("preserves upstream backpressure", async () => {
    let pullCount = 0;
    const upstreamBody = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pullCount += 1;
          controller.enqueue(new Uint8Array([pullCount]));
          controller.close();
        },
      },
      { highWaterMark: 0 }
    );
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4")
    );
    const fetchClipMedia = vi.fn().mockResolvedValue(new Response(upstreamBody));

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(pullCount).toBe(0);
    expect(await response.body!.getReader().read()).toEqual({
      done: false,
      value: new Uint8Array([1]),
    });
    expect(pullCount).toBe(1);
  });

  it("omits an invalid upstream content length", async () => {
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4")
    );
    const fetchClipMedia = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: {
          "Content-Length": "not-a-length",
        },
      })
    );

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(response.headers.get("Content-Length")).toBeNull();
  });

  it("preserves an upstream response with no body", async () => {
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4")
    );
    const fetchClipMedia = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("delivers partial bytes before propagating an upstream body error", async () => {
    let pullCount = 0;
    const upstreamError = new Error("upstream body failed");
    const upstreamBody = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pullCount += 1;
          if (pullCount === 1) {
            controller.enqueue(new Uint8Array([1, 2]));
            return;
          }
          controller.error(upstreamError);
        },
      },
      { highWaterMark: 0 }
    );
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4")
    );
    const fetchClipMedia = vi.fn().mockResolvedValue(new Response(upstreamBody));

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);
    const reader = response.body!.getReader();

    expect(await reader.read()).toEqual({
      done: false,
      value: new Uint8Array([1, 2]),
    });
    await expect(reader.read()).rejects.toBe(upstreamError);
  });

  it("returns a non-cacheable gateway response when the upstream fetch fails", async () => {
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4")
    );
    const fetchClipMedia = vi.fn().mockRejectedValue(new Error("network failed"));

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(response.status).toBe(502);
    expect(response.body).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("preserves an upstream HTTP failure without inventing a content type", async () => {
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("service down"));
        controller.close();
      },
    });
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4")
    );
    const fetchClipMedia = vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        status: 503,
        statusText: "Service Unavailable",
        headers: {
          "Content-Length": "12",
        },
      })
    );

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(response.status).toBe(503);
    expect(response.statusText).toBe("Service Unavailable");
    expect(response.headers.get("Content-Length")).toBe("12");
    expect(response.headers.get("Content-Type")).toBeNull();
    expect(await response.text()).toBe("service down");
  });

  it("rejects non-Twitch clip media URLs before fetching", async () => {
    const request = new Request(buildTwitchClipMediaUrl("https://example.com/clip.mp4"));
    const fetchClipMedia = vi.fn();

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(response.status).toBe(400);
    expect(fetchClipMedia).not.toHaveBeenCalled();
  });

  it("defaults successful clip responses to mp4 without inventing a content length", async () => {
    const request = new Request(
      buildTwitchClipMediaUrl("https://clips-media-assets2.twitch.tv/example.mp4")
    );
    const fetchClipMedia = vi.fn().mockResolvedValue(new Response(new Uint8Array([9, 8, 7])));

    const response = await handleTwitchClipMediaRequest(request, fetchClipMedia);

    expect(response.status).toBe(200);
    expect(fetchClipMedia).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "video/mp4,video/*;q=0.9,*/*;q=0.8" },
        cache: "no-store",
        redirect: "follow",
      })
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
  });
});
