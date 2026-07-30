import { describe, expect, it, vi } from "vitest";

import { createStartEnvironment } from "../../scripts/start-dev-lib.js";

// Guards: option 2 gives Vite and Electron the same private per-run relay capability
// without changing the environment used by Electron-only starts.
describe("development start environment", () => {
  it("adds a selected loopback port and per-run token only for browser development", async () => {
    const selectPort = vi.fn(async () => 54_321);
    const createToken = vi.fn(() => "fresh-private-token");

    await expect(
      createStartEnvironment(
        { BASE: "preserved", STREAMFUSION_BROWSER_DEV: "1" },
        { selectPort, createToken }
      )
    ).resolves.toMatchObject({
      BASE: "preserved",
      STREAMFUSION_BROWSER_DEV: "1",
      VITE_STREAMFUSION_BROWSER_DEV: "1",
      STREAMFUSION_DEV_RELAY_PORT: "54321",
      STREAMFUSION_DEV_RELAY_TOKEN: "fresh-private-token",
    });

    const electronOnly = await createStartEnvironment(
      { BASE: "preserved" },
      { selectPort, createToken }
    );
    expect(electronOnly).toEqual({ BASE: "preserved" });
    expect(selectPort).toHaveBeenCalledOnce();
    expect(createToken).toHaveBeenCalledOnce();
  });
});
