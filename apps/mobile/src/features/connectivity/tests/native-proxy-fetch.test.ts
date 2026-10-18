import { afterEach, describe, expect, it, vi } from "vitest";

import { createProxyFetch } from "../adapters/native-proxy-fetch";

const native = vi.hoisted(() => ({
  cancelProxyRequest: vi.fn(async () => undefined),
  proxyRequest: vi.fn(async () => ({
    kind: "completed" as const,
    status: 201,
    headers: { "content-type": "application/json" },
    body: '{"ok":true}',
  })),
}));

vi.mock(
  "../../../../modules/streamfusion-native-contracts/src/contracts",
  () => ({
    getConnectivityModule: () => ({ ...native, getContractVersion: () => 1 }),
  }),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("proxy-aware background transport", () => {
  it("uses the supplied background transport when the proxy is off", async () => {
    const direct = vi.fn(
      async () => new Response("background", { status: 200 }),
    );
    const fetch = createProxyFetch({
      directFetch: direct,
      readTransport: async () => ({ kind: "off" }),
      readCredentials: async () => null,
    });
    const response = await fetch("https://example.com/live");
    expect(await response.text()).toBe("background");
    expect(direct).toHaveBeenCalledWith("https://example.com/live", undefined);
    expect(native.proxyRequest).not.toHaveBeenCalled();
  });

  it("uses the native configured proxy and preserves its response", async () => {
    const direct = vi.fn(async () => new Response("wrong"));
    const fetch = createProxyFetch({
      directFetch: direct,
      readTransport: async () => ({
        kind: "on",
        host: "proxy.example",
        port: 8080,
      }),
      readCredentials: async () => ({ username: "alice", password: "secret" }),
    });
    const response = await fetch("https://example.com/gql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"query":"stream"}',
    });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('{"ok":true}');
    expect(native.proxyRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '{"query":"stream"}',
        host: "proxy.example",
        port: 8080,
        method: "POST",
        url: "https://example.com/gql",
        username: "alice",
        password: "secret",
      }),
    );
    expect(direct).not.toHaveBeenCalled();
  });

  it("rejects a pre-aborted proxy request when DOMException is absent", async () => {
    vi.stubGlobal("DOMException", undefined);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const fetch = createProxyFetch({
      readTransport: async () => ({
        kind: "on",
        host: "proxy.example",
        port: 8080,
      }),
      readCredentials: async () => null,
    });
    await expect(
      fetch("https://example.com/live", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(native.proxyRequest).not.toHaveBeenCalled();
  });
});
