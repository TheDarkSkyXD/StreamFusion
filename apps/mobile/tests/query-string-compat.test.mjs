import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const mobileDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const config = require("../metro.config.js");

test("Metro resolves public core subpaths inside the mapped Android workspace", () => {
  const resolution = config.resolver.resolveRequest(
    {
      originModulePath: path.join(
        mobileDirectory,
        "src/composition/mobile-runtime.tsx",
      ),
      resolveRequest() {
        throw new Error("workspace package fallback must not run");
      },
    },
    "@streamfusion/core/platform",
    "android",
  );

  assert.equal(
    resolution.filePath,
    path.resolve(mobileDirectory, "../../packages/core/src/platform/index.ts"),
  );
  assert.equal(resolution.type, "sourceFile");
});

test("Metro loads TanStack Query from the modern build", () => {
  for (const moduleName of ["@tanstack/react-query", "@tanstack/query-core"]) {
    const resolution = config.resolver.resolveRequest(
      {
        originModulePath: path.join(
          mobileDirectory,
          "src/composition/mobile-runtime.tsx",
        ),
        resolveRequest() {
          throw new Error("TanStack Query must not fall through to Metro");
        },
      },
      moduleName,
      "android",
    );
    assert.equal(
      resolution.filePath,
      path.resolve(
        mobileDirectory,
        "node_modules",
        moduleName,
        "build/modern/index.js",
      ),
    );
    assert.equal(resolution.type, "sourceFile");
  }
});

test("Metro searches only the mobile dependency install", () => {
  assert.deepEqual(config.resolver.nodeModulesPaths, [
    path.join(mobileDirectory, "node_modules"),
  ]);
  assert.ok(
    (config.watchFolders ?? []).every(
      (folder) =>
        !["desktop", "worker", "integration-relay"].some((name) =>
          folder.endsWith(`${path.sep}apps${path.sep}${name}`),
        ),
    ),
  );
});

test("Metro pins React Native resolution to the mobile workspace", () => {
  const origins = [];
  const resolution = config.resolver.resolveRequest(
    {
      originModulePath: path.join(
        mobileDirectory,
        "../../node_modules/react-native/index.js",
      ),
      resolveRequest(nextContext, moduleName, platform) {
        origins.push([nextContext.originModulePath, moduleName, platform]);
        return {
          filePath: path.join(
            mobileDirectory,
            "node_modules/react-native/index.js",
          ),
          type: "sourceFile",
        };
      },
    },
    "react-native",
    "android",
  );
  assert.deepEqual(origins, [
    [path.join(mobileDirectory, "package.json"), "react-native", "android"],
  ]);
  assert.equal(
    resolution.filePath,
    path.join(mobileDirectory, "node_modules/react-native/index.js"),
  );
});
