import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadEnv } = vi.hoisted(() => ({
  loadEnv: vi.fn(),
}));

vi.mock("electron-vite", () => ({ defineConfig: (config: unknown) => config }));
vi.mock("vite", () => ({ loadEnv }));
vi.mock("@vitejs/plugin-react", () => ({ default: vi.fn(() => ({ name: "react" })) }));
vi.mock("vite-plugin-svgr", () => ({ default: vi.fn(() => ({ name: "svgr" })) }));
vi.mock("vite-plugin-compression", () => ({
  default: vi.fn(() => ({ name: "compression" })),
}));
vi.mock("rollup-plugin-visualizer", () => ({
  visualizer: vi.fn(() => ({ name: "visualizer" })),
}));

import electronViteConfig from "../../electron.vite.config";

const createElectronViteConfig = electronViteConfig as unknown as (environment: {
  command: "build" | "serve";
  mode: string;
}) => Promise<Record<string, unknown>> | Record<string, unknown>;

// Guards: the custom Cloudflare Worker URL is available to Electron's trusted main process without being embedded in renderer configuration
// Guards: the explicit Twitch ad-frame proof route composes with browser development without replacing its authenticated relay
// Guards: production renderer configuration cannot expose the proof route even when its flag leaks into the build environment
describe("Electron Vite environment boundary", () => {
  beforeEach(() => {
    loadEnv.mockReset();
  });

  it("defines the loaded Worker base URL for main only", async () => {
    const workerBaseUrl = "https://worker-config-test.invalid";
    loadEnv.mockReturnValue({
      STREAMFUSION_WORKER_BASE_URL: workerBaseUrl,
    });

    const config = await createElectronViteConfig({
      command: "build",
      mode: "test",
    });
    const main = config.main as { define?: Record<string, string> };

    expect(main.define?.["process.env.STREAMFUSION_WORKER_BASE_URL"]).toBe(
      JSON.stringify(workerBaseUrl)
    );

    const renderer = config.renderer as { define?: Record<string, string> };
    expect(renderer.define?.["process.env.STREAMFUSION_WORKER_BASE_URL"]).toBeUndefined();
    expect(JSON.stringify(renderer)).not.toContain(workerBaseUrl);
  });

  it("wires an explicitly enabled Twitch ad-frame proof proxy into the renderer dev server", async () => {
    loadEnv.mockReturnValue({
      STREAMFUSION_TWITCH_AD_FRAME_PROOF: "adframe-20260803-r3",
    });

    const config = await createElectronViteConfig({
      command: "serve",
      mode: "development",
    });
    const renderer = config.renderer as {
      server?: { proxy?: Record<string, { target?: string }> };
    };

    expect(
      renderer.server?.proxy?.["/__streamfusion-proof/twitch-ad-frame/adframe-20260803-r3/"]
    ).toMatchObject({ target: "http://127.0.0.1:18765" });
  });

  it("preserves the authenticated browser relay when the proof route is also enabled", async () => {
    loadEnv.mockReturnValue({
      STREAMFUSION_BROWSER_DEV: "1",
      STREAMFUSION_DEV_RELAY_PORT: "54321",
      STREAMFUSION_DEV_RELAY_TOKEN: "per-run-token",
      STREAMFUSION_TWITCH_AD_FRAME_PROOF: "adframe-20260803-r3",
    });

    const config = await createElectronViteConfig({
      command: "serve",
      mode: "development",
    });
    const renderer = config.renderer as {
      server?: {
        open?: string;
        proxy?: Record<
          string,
          {
            target?: string;
            ws?: boolean;
            changeOrigin?: boolean;
            headers?: Record<string, string>;
          }
        >;
      };
    };

    expect(renderer.server?.open).toBe("/browser.html");
    expect(renderer.server?.proxy?.["/__streamfusion-dev"]).toEqual({
      target: "http://127.0.0.1:54321",
      ws: true,
      changeOrigin: false,
      headers: { "x-streamfusion-dev-token": "per-run-token" },
    });
    expect(
      renderer.server?.proxy?.["/__streamfusion-proof/twitch-ad-frame/adframe-20260803-r3/"]
    ).toMatchObject({ target: "http://127.0.0.1:18765" });
  });

  it("omits the proof route from production renderer configuration when the flag leaks in", async () => {
    loadEnv.mockReturnValue({
      STREAMFUSION_TWITCH_AD_FRAME_PROOF: "leaked-production-proof",
    });

    const config = await createElectronViteConfig({
      command: "build",
      mode: "production",
    });
    const serializedRenderer = JSON.stringify(config.renderer);

    expect(serializedRenderer).not.toContain("/__streamfusion-proof/twitch-ad-frame");
    expect(serializedRenderer).not.toContain("leaked-production-proof");
    expect(serializedRenderer).not.toContain("127.0.0.1:18765");
  });
});
