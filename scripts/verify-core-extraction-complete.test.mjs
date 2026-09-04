import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { findExtractionViolations } from "./verify-core-extraction-complete.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

function fixtureRoot() {
  const root = mkdtempSync(
    path.join(tmpdir(), "streamfusion-core-extraction-"),
  );
  for (const directory of [
    "apps/desktop/src",
    "packages/core",
    "packages/core/tests",
  ]) {
    cpSync(path.join(repositoryRoot, directory), path.join(root, directory), {
      recursive: true,
    });
  }
  return root;
}

test("the extraction predicate rejects compatibility exports and migration exceptions", () => {
  const root = fixtureRoot();
  try {
    const compatibilityPath = path.join(
      root,
      "apps/desktop/src/compatibility.ts",
    );
    writeFileSync(
      compatibilityPath,
      'export { channelsMatch } from "@streamfusion/core/platform";\n',
    );
    const authTypesPath = path.join(
      root,
      "apps/desktop/src/shared/auth-types.ts",
    );
    writeFileSync(
      authTypesPath,
      `${readFileSync(authTypesPath, "utf8")}\nexport const DEFAULT_NOTIFICATION_PREFERENCES = {};\n`,
    );
    const eslintPath = path.join(root, "packages/core/eslint.config.mjs");
    writeFileSync(
      eslintPath,
      `${readFileSync(eslintPath, "utf8")}\n// migration-shim\n`,
    );

    const violations = findExtractionViolations(root);
    assert.ok(
      violations.some((violation) => violation.includes("compatibility.ts")),
    );
    assert.ok(
      violations.some((violation) => violation.includes("migration-shim")),
    );
    assert.ok(
      violations.some((violation) =>
        violation.includes("DEFAULT_NOTIFICATION_PREFERENCES"),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
