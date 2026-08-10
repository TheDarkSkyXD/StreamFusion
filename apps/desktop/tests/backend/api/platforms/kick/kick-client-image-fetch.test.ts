// Regression test for the kick-image:// 404 latch fix.
//
// Pre-fix, `fetchImageBytes` short-circuited to null whenever the platform
// health gate was active. The kick-image:// protocol handler translated null
// into HTTP 404, which fired <img>.onerror in the renderer, which latched
// the broken state in the caller's hasError flag. A single unhealthy window
// therefore left avatars/thumbnails stuck on the fallback initial until the
// host component remounted. The fix removes the gate from image fetches only
// (other Kick callers, API/stream polls, still gate on platform health
// because they have their own retry budgets and benefit from the brief
// back-off).
//
// Strategy: stub `electronRequestBinary` on the kickClient singleton via
// vi.spyOn so the assertion measures the actual contract — "fetchImageBytes
// reached its network boundary even though the gate would have blocked it" —
// without depending on Electron's net/session module shape or vitest's
// require/import interop. A direct assertion on the spy is the cleanest
// proof: pre-fix it is never called; post-fix it is.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/api/platforms/kick/kick-network-health", () => ({
  acquireKickRequestSlot: vi.fn(async () => () => {}),
}));

// Simulate the bug condition: platform is marked unhealthy.
vi.mock("@/backend/api/unified/platform-health", () => ({
  isPlatformHealthy: vi.fn(() => false),
  recordPlatformLocalNetError: vi.fn(),
}));

vi.mock("@/backend/auth/kick-auth", () => ({
  kickAuthService: { getAccessToken: () => null },
}));

describe("kickClient.fetchImageBytes — network-down gate", () => {
  // Guards: fetchImageBytes must reach its network boundary even when isPlatformHealthy() is false; one-shot image fetches that short-circuit leave the caller latched on the error fallback until remount (regression: this PR).

  // Guards: a transient first-attempt timeout must retry the same real Kick image URL before the protocol reports the thumbnail unavailable.
  let kickClient: typeof import("@/backend/api/platforms/kick/kick-client").kickClient;

  beforeEach(async () => {
    vi.resetModules();
    ({ kickClient } = await import("@/backend/api/platforms/kick/kick-client"));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("attempts the binary fetch even when isPlatformHealthy() is false", async () => {
    // Pre-condition: the mocked health module reports platform as unhealthy.
    // If the pre-fetch gate were still in place, fetchImageBytes would return
    // null here without invoking the binary-fetch boundary.
    const health = await import("@/backend/api/unified/platform-health");
    expect(health.isPlatformHealthy("kick")).toBe(false);

    // Spy on the private network boundary. The cast to `any` is the test
    // seam; production callers never reach this method directly.
    const fakeBytes = { buffer: Buffer.from([1, 2, 3, 4]), contentType: "image/webp" };
    const spy = vi
      // biome-ignore lint/suspicious/noExplicitAny: private-method test seam
      .spyOn(kickClient as any, "electronRequestBinary")
      .mockResolvedValue({ ...fakeBytes, statusCode: 200 });

    const result = await kickClient.fetchImageBytes("https://files.kick.com/images/test.webp");

    // Direct contract: the binary fetch was attempted (gate bypassed) AND
    // the result flows back to the caller as bytes (not null). Pre-fix, the
    // spy is never called and result is null — both assertions flip.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      "https://files.kick.com/images/test.webp",
      expect.objectContaining({ Referer: "https://kick.com/" }),
      3000
    );
    expect(result).not.toBeNull();
    expect(result?.buffer.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
    expect(result?.contentType).toBe("image/webp");
  });

  it("retries a transient image timeout with a longer bounded timeout", async () => {
    const fakeBytes = { buffer: Buffer.from([5, 6, 7, 8]), contentType: "image/webp" };
    const spy = vi
      // biome-ignore lint/suspicious/noExplicitAny: private-method test seam
      .spyOn(kickClient as any, "electronRequestBinary")
      .mockRejectedValueOnce(new Error("The operation was aborted due to timeout"))
      .mockResolvedValueOnce({ ...fakeBytes, statusCode: 200 });

    const url = "https://images.kick.com/video_thumbnails/channel/video/720.webp";
    const result = await kickClient.fetchImageBytes(url);

    expect(spy).toHaveBeenNthCalledWith(1, url, expect.any(Object), 3000);
    expect(spy).toHaveBeenNthCalledWith(2, url, expect.any(Object), 8000);
    expect(result?.buffer.equals(fakeBytes.buffer)).toBe(true);
  });
});
