import { afterEach, describe, expect, it } from "vitest";

import { createBrowserDevelopmentConfig } from "@/dev-relay/config";

const ORIGINAL_BROWSER_DEV = process.env.STREAMFUSION_BROWSER_DEV;
const ORIGINAL_RELAY_PORT = process.env.STREAMFUSION_DEV_RELAY_PORT;
const ORIGINAL_RELAY_TOKEN = process.env.STREAMFUSION_DEV_RELAY_TOKEN;

afterEach(() => {
  process.env.STREAMFUSION_BROWSER_DEV = ORIGINAL_BROWSER_DEV;
  process.env.STREAMFUSION_DEV_RELAY_PORT = ORIGINAL_RELAY_PORT;
  process.env.STREAMFUSION_DEV_RELAY_TOKEN = ORIGINAL_RELAY_TOKEN;
});

// Guards: the browser entry and authenticated relay proxy exist only when option 2 starts development.
describe("browser development Vite config", () => {
  it("adds the browser entry, opens it, and proxies the authenticated local relay", async () => {
    process.env.STREAMFUSION_BROWSER_DEV = "1";
    process.env.STREAMFUSION_DEV_RELAY_PORT = "54321";
    process.env.STREAMFUSION_DEV_RELAY_TOKEN = "per-run-token";

    const config = createBrowserDevelopmentConfig({
      command: "serve",
      mode: "development",
      env: process.env,
    });

    expect(config.enabled).toBe(true);
    expect(config.browserEntry).toBe("browser.html");
    expect(config.server?.open).toBe("/browser.html");
    expect(config.server?.proxy["/__streamfusion-dev"]).toMatchObject({
      target: "http://127.0.0.1:54321",
      ws: true,
      changeOrigin: false,
      headers: { "x-streamfusion-dev-token": "per-run-token" },
    });
  });

  it("omits the browser entry and relay from production even when the opt-in variable leaks in", () => {
    const config = createBrowserDevelopmentConfig({
      command: "build",
      mode: "production",
      env: {
        STREAMFUSION_BROWSER_DEV: "1",
        STREAMFUSION_DEV_RELAY_PORT: "54321",
        STREAMFUSION_DEV_RELAY_TOKEN: "per-run-token",
      },
    });

    expect(config).toEqual({ enabled: false });
  });
});
