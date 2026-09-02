import { beforeEach, describe, expect, it, vi } from "vitest";

const defaultSessionFetch = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  session: {
    defaultSession: { fetch: defaultSessionFetch },
  },
}));

import { appNetwork, createAppNetwork } from "@backend/services/app-network";

// Guards: default-session requests retain Electron's proxy-aware Chromium transport.
// Guards: callers can inject a session fetch capability without replacing global fetch.
// Guards: importing main-process services does not resolve Electron's default session before a request.
describe("AppNetwork", () => {
  beforeEach(() => {
    defaultSessionFetch.mockReset();
  });

  it("routes the production capability through the default session", async () => {
    const response = new Response("ok");
    defaultSessionFetch.mockResolvedValue(response);

    await expect(appNetwork.fetch("https://example.com/status", { method: "GET" })).resolves.toBe(
      response
    );
    expect(defaultSessionFetch).toHaveBeenCalledWith("https://example.com/status", {
      method: "GET",
    });
  });

  it("uses an injected session capability for deterministic callers", async () => {
    const sessionFetch = vi.fn().mockResolvedValue(new Response("injected"));
    const getNetworkSession = vi.fn(() => ({ fetch: sessionFetch }));
    const network = createAppNetwork(getNetworkSession);

    await network.fetch("https://example.com/health");

    expect(getNetworkSession).toHaveBeenCalledOnce();
    expect(sessionFetch).toHaveBeenCalledWith("https://example.com/health", undefined);
    expect(defaultSessionFetch).not.toHaveBeenCalled();
  });

  it("does not resolve the Electron session until a request is made", () => {
    const getNetworkSession = vi.fn(() => ({ fetch: defaultSessionFetch }));

    createAppNetwork(getNetworkSession);

    expect(getNetworkSession).not.toHaveBeenCalled();
  });
});
