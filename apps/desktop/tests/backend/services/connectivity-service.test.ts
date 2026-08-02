import { describe, expect, it, vi } from "vitest";

import { checkInternetReachability } from "@/backend/services/connectivity-service";

// Guards: a failed primary reachability endpoint falls back to a second neutral endpoint before the app declares itself offline.
describe("checkInternetReachability", () => {
  it("reports reachable when the fallback endpoint returns the expected no-content response", async () => {
    const request = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new Error("primary unavailable"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await checkInternetReachability({
      request,
      endpoints: ["https://primary.example/204", "https://fallback.example/204"],
      timeoutMs: 1_000,
    });

    expect(result).toEqual({ reachable: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("reports offline when no endpoint proves end-to-end reachability", async () => {
    const request = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response("captive portal", { status: 200 }));

    await expect(
      checkInternetReachability({
        request,
        endpoints: ["https://primary.example/204", "https://fallback.example/204"],
        timeoutMs: 1_000,
      })
    ).resolves.toEqual({ reachable: false });

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("bounds every endpoint probe with a short abort timeout", async () => {
    vi.useFakeTimers();
    const request = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });

    try {
      const resultPromise = checkInternetReachability({
        request,
        endpoints: ["https://primary.example/204", "https://fallback.example/204"],
        timeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(200);

      await expect(resultPromise).resolves.toEqual({ reachable: false });
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
