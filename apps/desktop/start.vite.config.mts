import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { startRoutes } from "./start.routes.mjs";
import { createBrowserDevelopmentConfig } from "./src/frontend/dev-relay/config";

export default defineConfig(({ command, mode }) => {
  const browserDevelopment = createBrowserDevelopmentConfig({
    command,
    mode,
    env: { ...process.env, ...loadEnv(mode, process.cwd(), "") },
  });
  return {
    base: command === "build" ? "./" : "/",
    server: { ...browserDevelopment.server, host: "127.0.0.1", open: false },
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/frontend"),
        "@frontend": resolve(__dirname, "src/frontend"),
        "@shared": resolve(__dirname, "src/shared"),
      },
    },
    plugins: [
      {
        name: "streamfusion-start-server-module",
        generateBundle() {
          if (this.environment.name === "ssr") {
            this.emitFile({ type: "asset", fileName: "package.json", source: '{"type":"module"}' });
          }
        },
      },
      {
        name: "streamfusion-desktop-entries",
        configureServer(server) {
          server.middlewares.use(async (request, response, next) => {
            const pathname = request.url?.split("?")[0];
            if (pathname === "/browser.html" && browserDevelopment.enabled) {
              const destination = new URL(request.url!, "http://localhost");
              destination.pathname = "/";
              destination.searchParams.set("streamfusion-browser-dev", "1");
              response.writeHead(302, { Location: destination.pathname + destination.search });
              response.end();
              return;
            }
            if (pathname !== "/src/frontend/slot-renderer/index.html") return next();
            try {
              const source = await readFile(
                resolve(__dirname, "src/frontend/slot-renderer/index.html"),
                "utf8"
              );
              const html = await server.transformIndexHtml(pathname, source);
              response.setHeader("Content-Type", "text/html");
              response.end(html);
            } catch (error) {
              next(error);
            }
          });
        },
      },
      tanstackStart({
        vite: { installDevServerMiddleware: true },
        srcDirectory: "src/frontend",
        router: {
          entry: "routes/start-router.tsx",
          basepath: "/",
          routesDirectory: ".",
          virtualRouteConfig: startRoutes,
          generatedRouteTree: "routes/start-routeTree.gen.ts",
          codeSplittingOptions: { defaultBehavior: [] },
        },
        client: { entry: "renderer/start-client.tsx" },
        spa: { enabled: true, prerender: { outputPath: "/index.html" } },
      }),
      react(),
      svgr(),
    ],
    build: { outDir: ".cache/start/raw", target: "esnext" },
    environments: {
      ssr: { build: { rollupOptions: { output: { entryFileNames: "[name].js" } } } },
    },
  };
});
