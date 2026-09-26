import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { createDesktopConfig } from "./electron.vite.config";

export default defineConfig((environment) => {
  const { preload } = createDesktopConfig(environment);
  return {
    preload: {
      ...preload,
      build: {
        ...preload.build,
        externalizeDeps: false,
        emptyOutDir: false,
        outDir:
          process.env.STREAMFUSION_START_PRELOAD_DIR ||
          resolve(__dirname, ".cache/start/app/out/preload"),
        rollupOptions: { input: { slot: resolve(__dirname, "src/backend/preload/slot.ts") } },
      },
    },
  };
});
