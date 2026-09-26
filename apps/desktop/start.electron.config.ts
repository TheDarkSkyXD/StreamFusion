import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import { createDesktopConfig } from "./electron.vite.config";

export default defineConfig((environment) => {
  const config = createDesktopConfig(environment);
  const output = resolve(__dirname, ".cache/start/app/out");
  return {
    main: { ...config.main, build: { ...config.main.build, outDir: resolve(output, "main") } },
    preload: {
      ...config.preload,
      plugins: [
        {
          name: "streamfusion-start-preload-reload",
          apply: () => environment.command === "serve",
          writeBundle() {
            if (process.connected) {
              process.send?.({ type: "streamfusion-preload-rebuilt" });
            }
          },
        },
      ],
      build: {
        ...config.preload.build,
        outDir: resolve(output, "preload"),
        externalizeDeps: false,
        emptyOutDir: false,
        rollupOptions: {
          input: { index: resolve(__dirname, "src/backend/preload/index.ts") },
        },
      },
    },
    renderer:
      environment.command === "serve"
        ? undefined
        : {
            ...config.renderer,
            build: {
              ...config.renderer.build,
              outDir: resolve(output, "renderer"),
              rollupOptions: {
                input: { slot: resolve(__dirname, "src/frontend/slot-renderer/index.html") },
              },
            },
          },
  };
});
