import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const coreRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(coreRoot, "../..");
const packageJson = JSON.parse(
  readFileSync(path.join(coreRoot, "package.json"), "utf8"),
);
const publicSubpaths = [
  "platform",
  "content",
  "discovery",
  "follows",
  "auth",
  "chat",
  "activity",
  "reliability",
  "relay",
  "testing",
];

function readJson(relativePath) {
  return JSON.parse(
    readFileSync(path.join(repositoryRoot, relativePath), "utf8"),
  );
}

function assertPathNotExported(resolve) {
  assert.throws(
    resolve,
    (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
}

test("core exposes only the approved public subpaths", () => {
  assert.deepEqual(
    packageJson.exports,
    Object.fromEntries(
      publicSubpaths.map((subpath) => [
        `./${subpath}`,
        {
          types: `./src/${subpath}/index.ts`,
          default: `./src/${subpath}/index.ts`,
        },
      ]),
    ),
  );
  assert.equal(packageJson.exports["."], undefined);

  for (const subpath of publicSubpaths) {
    assert.equal(
      fileURLToPath(import.meta.resolve(`@streamfusion/core/${subpath}`)),
      path.join(coreRoot, "src", subpath, "index.ts"),
    );
  }
});

test("ES module and CommonJS resolution reject root and deep imports", () => {
  const require = createRequire(import.meta.url);
  for (const specifier of [
    "@streamfusion/core",
    "@streamfusion/core/src/platform/index.ts",
    "@streamfusion/core/platform/internal",
  ]) {
    assertPathNotExported(() => import.meta.resolve(specifier));
    assertPathNotExported(() => require.resolve(specifier));
  }
});

test("Desktop and Worker reference core and the root gate orders core first", () => {
  const desktopTsconfig = readJson("apps/desktop/tsconfig.json");
  const workerTsconfig = readJson("apps/worker/tsconfig.json");
  const rootPackage = readJson("package.json");

  assert.deepEqual(desktopTsconfig.references, [
    { path: "../../packages/core" },
  ]);
  assert.deepEqual(workerTsconfig.references, [
    { path: "../../packages/core" },
  ]);
  assert.match(
    rootPackage.scripts.lint,
    /--workspace @streamfusion\/core lint/,
  );
  assert.match(
    rootPackage.scripts.test,
    /^npm run --workspace @streamfusion\/core test/,
  );
  assert.match(
    rootPackage.scripts.typecheck,
    /^npm run --workspace @streamfusion\/core typecheck/,
  );
});
