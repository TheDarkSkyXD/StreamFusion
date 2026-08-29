import { describe, expect, it, vi } from "vitest";

import { BoundedReadError, runBoundedJsonRead } from "@backend/reliability/bounded-json-read";

// Guards: bounded reads retry transient responses inside one absolute operation budget.
// Guards: cancellation prevents queued or future attempts and schema failures never retry.
// Guards: oversized or malformed upstream bodies never enter application state.
describe("runBoundedJsonRead", () => {
  it("retries a transient read once and decodes the successful response", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const attempt = vi
      .fn<(signal: AbortSignal) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response('{"value":"ready"}', { status: 200 }));

    await expect(
      runBoundedJsonRead({
        dependency: "fixture",
        maxAttempts: 2,
        attempt,
        decode: (value) => (value as { value: string }).value,
      })
    ).resolves.toBe("ready");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("does not start work after caller cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const attempt = vi.fn<(signal: AbortSignal) => Promise<Response>>();

    await expect(
      runBoundedJsonRead({
        dependency: "fixture",
        signal: controller.signal,
        attempt,
        decode: (value) => value,
      })
    ).rejects.toMatchObject({ code: "canceled" });
    expect(attempt).not.toHaveBeenCalled();
  });

  it("classifies a schema failure and never retries it", async () => {
    const attempt = vi
      .fn<(signal: AbortSignal) => Promise<Response>>()
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await expect(
      runBoundedJsonRead({
        dependency: "fixture",
        maxAttempts: 3,
        attempt,
        decode: () => {
          throw new Error("shape changed");
        },
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<BoundedReadError>>({ code: "upstream_schema" })
    );
    expect(attempt).toHaveBeenCalledOnce();
  });

  it("rejects a response body larger than the configured boundary", async () => {
    await expect(
      runBoundedJsonRead({
        dependency: "fixture",
        maxBodyBytes: 4,
        attempt: async () => new Response('{"value":1}', { status: 200 }),
        decode: (value) => value,
      })
    ).rejects.toMatchObject({ code: "response_too_large" });
  });
});
