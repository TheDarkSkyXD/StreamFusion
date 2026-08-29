import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, handleMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  handleMock: vi.fn(),
}));

vi.mock("electron", () => ({
  net: { fetch: fetchMock },
  protocol: { handle: handleMock },
}));

import { resetImageByteCacheForTests } from "@backend/protocols/image-byte-cache";
import { registerTwitchImageProtocol } from "@backend/protocols/twitch-image-protocol";

// Guards: valid Twitch avatars mislabeled as binary/octet-stream must not become fallbacks.
describe("twitch image protocol", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    handleMock.mockReset();
    resetImageByteCacheForTests();
  });

  it("serves JPEG avatar bytes when Twitch labels them as binary octet-stream", async () => {
    const jpegBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
    ]);
    fetchMock.mockResolvedValue(
      new Response(jpegBytes, {
        status: 200,
        headers: { "Content-Type": "binary/octet-stream" },
      })
    );
    registerTwitchImageProtocol();
    const handler = handleMock.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;
    const upstream =
      "https://static-cdn.jtvnw.net/jtv_user_pictures/splitsie-profile_image-example-300x300.jpeg";
    const encoded = Buffer.from(upstream, "utf-8").toString("base64url");

    const response = await handler(new Request(`twitch-image://image?u=${encoded}`));

    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpegBytes);
  });

  it("reuses successful avatar bytes without another upstream request", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    fetchMock.mockResolvedValue(
      new Response(jpegBytes, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    );
    registerTwitchImageProtocol();
    const handler = handleMock.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;
    const upstream =
      "https://static-cdn.jtvnw.net/jtv_user_pictures/cached-profile_image-example.jpeg";
    const requestUrl = `twitch-image://image?u=${Buffer.from(upstream, "utf-8").toString("base64url")}`;

    await handler(new Request(requestUrl));
    const cachedResponse = await handler(new Request(requestUrl));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await cachedResponse.arrayBuffer())).toEqual(jpegBytes);
  });
});
