import { describe, expect, it, vi } from "vitest";
import { createKickPublicClientConfigurationResolver } from "../adapters/kick/kick-client-config";

describe("Kick public client configuration", () => {
  it("uses a public override without fetching", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const resolver = createKickPublicClientConfigurationResolver({
      override: " mobile-kick ",
      fetcher,
    });
    expect(await resolver.resolve()).toEqual({ clientId: "mobile-kick" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("coalesces and caches success, and retries after a failed response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "configuration_unavailable" }, { status: 503 }),
      )
      .mockResolvedValueOnce(Response.json({ clientId: "public-kick" }));
    const resolver = createKickPublicClientConfigurationResolver({
      workerBaseUrl: "https://worker.test",
      fetcher,
    });
    await expect(resolver.resolve()).rejects.toThrow(
      "Kick configuration is unavailable.",
    );
    const [first, second] = await Promise.all([
      resolver.resolve(),
      resolver.resolve(),
    ]);
    expect(first).toEqual({ clientId: "public-kick" });
    expect(second).toEqual(first);
    expect(await resolver.resolve()).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://worker.test/auth/kick/config",
    );
  });

  it("bounds an unresponsive worker request and permits a later retry", async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(
          async (_url, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true },
              );
            }),
        )
        .mockResolvedValueOnce(Response.json({ clientId: "recovered-kick" }));
      const resolver = createKickPublicClientConfigurationResolver({ fetcher });
      const pending = resolver.resolve();
      const failure = expect(pending).rejects.toThrow("aborted");
      await vi.advanceTimersByTimeAsync(10_000);
      await failure;
      expect(await resolver.resolve()).toEqual({ clientId: "recovered-kick" });
    } finally {
      vi.useRealTimers();
    }
  });
});
