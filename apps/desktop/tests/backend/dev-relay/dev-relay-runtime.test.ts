import { describe, expect, it, vi } from "vitest";

import { startConfiguredDevRelay } from "@/backend/dev-relay/dev-relay-runtime";

// Guards: option 2 starts one loopback relay with the same origin, port, and capability
// prepared by the development launcher; packaged production can never start it.
describe("configured development relay", () => {
  it("starts only for unpackaged browser development", async () => {
    const relay = { close: vi.fn(async () => undefined) };
    const startServer = vi.fn(async () => relay);
    const fetchMedia = vi.fn();
    const environment = {
      STREAMFUSION_BROWSER_DEV: "1",
      STREAMFUSION_DEV_RELAY_PORT: "54321",
      STREAMFUSION_DEV_RELAY_TOKEN: "per-run-token",
    };

    await expect(
      startConfiguredDevRelay({
        isPackaged: false,
        environment,
        rendererUrl: "http://localhost:5173",
        fetchMedia,
        startServer,
      })
    ).resolves.toBe(relay);
    expect(startServer).toHaveBeenCalledWith({
      fetchMedia,
      port: 54_321,
      token: "per-run-token",
      origin: "http://localhost:5173",
    });

    await expect(
      startConfiguredDevRelay({
        isPackaged: true,
        environment,
        rendererUrl: "http://localhost:5173",
        fetchMedia,
        startServer,
      })
    ).resolves.toBeNull();
    expect(startServer).toHaveBeenCalledOnce();
  });
});
