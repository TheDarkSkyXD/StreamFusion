import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";
import { startRoutes } from "../start.routes.mts";

const root = resolve(import.meta.dirname, "..");
const generatedRouteTree = resolve(root, "src/frontend/routes/start-routeTree.gen.ts");
const config = getConfig(
  {
    target: "react",
    routesDirectory: resolve(root, "src/frontend"),
    virtualRouteConfig: startRoutes,
    generatedRouteTree,
    routeTreeFileFooter: [
      [
        "import type { getRouter } from './start-router.tsx'",
        "import type { createStart } from '@tanstack/react-start'",
        "declare module '@tanstack/react-start' {",
        "  interface Register {",
        "    ssr: true",
        "    router: Awaited<ReturnType<typeof getRouter>>",
        "  }",
        "}",
      ].join("\n"),
    ],
  },
  root
);
const before = process.argv.includes("--check") ? await readFile(generatedRouteTree, "utf8") : null;
await new Generator({ root, config }).run();
const first = await readFile(generatedRouteTree, "utf8");
await new Generator({ root, config }).run();
const second = await readFile(generatedRouteTree, "utf8");
if (first !== second) throw new Error("Start route generation is not reproducible");
if (before !== null && before !== first)
  throw new Error("Start route tree was stale; review and commit the regenerated file");
console.log("Start route tree is reproducible");
