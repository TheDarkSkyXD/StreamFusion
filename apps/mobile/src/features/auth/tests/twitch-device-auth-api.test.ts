import { describe, expect, it, vi } from "vitest";

import { createTwitchDeviceAuthApi } from "@mobile/features/auth/adapters/twitch/twitch-device-auth-api";

const cancellation = { aborted: false, onCancel: () => () => undefined };

describe("Twitch Device Code transport", () => {
  it("uses provider slowdown pacing and distinguishes validation failures", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "slow_down" }), {
          status: 400,
          headers: { "Retry-After": "9" },
        }),
      )
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockRejectedValueOnce(new Error("offline"));
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      fetch: fetcher,
    });
    await expect(api.poll("device-code", cancellation)).resolves.toEqual({
      kind: "slow-down",
      retryAfterSeconds: 9,
    });
    await expect(api.validate("access", cancellation)).resolves.toEqual({
      kind: "revoked",
    });
    await expect(api.validate("access", cancellation)).resolves.toMatchObject({
      kind: "transient-failure",
    });
  });

  it("uses Retry-After before parsing a throttled response body", async () => {
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      fetch: vi.fn(
        async () =>
          new Response("not json", {
            status: 429,
            headers: { "Retry-After": "12" },
          }),
      ),
    });
    await expect(api.poll("device-code", cancellation)).resolves.toEqual({
      kind: "slow-down",
      retryAfterSeconds: 12,
    });
  });

  it("rejects an untrusted verification URI", async () => {
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      fetch: vi.fn(async () =>
        Response.json({
          device_code: "device",
          user_code: "ABCDEFGH",
          verification_uri: "custom-scheme://credentials",
          expires_in: 300,
          interval: 5,
        }),
      ),
    });
    await expect(api.request([], cancellation)).rejects.toThrow(
      "invalid verification URI",
    );
  });

  it("never sends a client secret and treats a refresh response loss as uncertain", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("response lost");
    });
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      fetch: fetcher,
    });
    await expect(
      api.refresh("one-time-refresh", cancellation),
    ).resolves.toMatchObject({ kind: "outcome-unknown" });
    const body = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(body).toContain("client_id=public-client");
    expect(body).not.toContain("client_secret");
  });

  it("treats a malformed refresh success as an uncertain consumed grant", async () => {
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      fetch: vi.fn(async () => Response.json({ access_token: "rotated" })),
    });
    await expect(
      api.refresh("one-time-refresh", cancellation),
    ).resolves.toMatchObject({
      kind: "outcome-unknown",
    });
  });

  it("bounds a request that never returns", async () => {
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      timeoutMilliseconds: 5,
      fetch: vi.fn(
        async (_url, init) =>
          await new Promise<Response>((_resolve, reject) => {
            if (!(init?.signal instanceof AbortSignal))
              throw new Error("missing abort signal");
            init.signal.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    });
    await expect(api.request([], cancellation)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("keeps the deadline active while the response body is pending", async () => {
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      timeoutMilliseconds: 5,
      fetch: vi.fn(async (_url, init) => {
        const response = new Response();
        response.json = async () =>
          await new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          });
        return response;
      }),
    });
    await expect(api.request([], cancellation)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("cancels while the response body is pending", async () => {
    let cancel: (() => void) | undefined;
    const signal = {
      aborted: false,
      onCancel: (listener: () => void) => {
        cancel = listener;
        return () => undefined;
      },
    };
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      fetch: vi.fn(async (_url, init) => {
        const response = new Response();
        response.json = async () =>
          await new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          });
        return response;
      }),
    });
    const request = api.request([], signal);
    await vi.waitFor(() => expect(cancel).toBeTypeOf("function"));
    cancel?.();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not dispatch a refresh that was already cancelled", async () => {
    const fetcher = vi.fn();
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      fetch: fetcher,
    });
    await expect(
      api.refresh("refresh", { ...cancellation, aborted: true }),
    ).resolves.toMatchObject({ kind: "not-sent" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps account lookup transport failure to a typed transient result", async () => {
    const api = createTwitchDeviceAuthApi({
      clientId: "public-client",
      fetch: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    await expect(
      api.loadAccount("access", "u1", cancellation),
    ).resolves.toMatchObject({ kind: "transient-failure" });
  });
});
