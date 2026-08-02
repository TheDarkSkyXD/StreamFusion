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

// Guards: the custom Cloudflare Worker URL is available to Electron's trusted main process without being embedded in renderer configuration
describe("Electron Vite environment boundary", () => {
  beforeEach(() => {
    loadEnv.mockReset();
  });

  it("defines the loaded Worker base URL for main only", async () => {
    const workerBaseUrl = "https://worker-config-test.invalid";
    loadEnv.mockReturnValue({
      STREAMFUSION_WORKER_BASE_URL: workerBaseUrl,
    });

    const createConfig = electronViteConfig as unknown as (environment: {
      command: "build";
      mode: string;
    }) => Promise<Record<string, unknown>> | Record<string, unknown>;
    const config = await createConfig({ command: "build", mode: "test" });
    const main = config.main as { define?: Record<string, string> };

    expect(main.define?.["process.env.STREAMFUSION_WORKER_BASE_URL"]).toBe(
      JSON.stringify(workerBaseUrl)
    );

    const renderer = config.renderer as { define?: Record<string, string> };
    expect(renderer.define?.["process.env.STREAMFUSION_WORKER_BASE_URL"]).toBeUndefined();
    expect(JSON.stringify(renderer)).not.toContain(workerBaseUrl);
  });
});
