import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const eslint = new ESLint({
  cwd: repositoryRoot,
  overrideConfigFile: path.join(
    repositoryRoot,
    "eslint.core-imports.config.mjs",
  ),
});

const sourceExtensions = "{js,mjs,cjs,jsx,ts,tsx}";
const results = await eslint.lintFiles([
  `apps/**/*.${sourceExtensions}`,
  `packages/**/*.${sourceExtensions}`,
]);
const errors = results.flatMap((result) =>
  result.messages
    .filter(
      (message) =>
        message.ruleId === "streamfusion/core-import-boundary" &&
        message.severity === 2,
    )
    .map(
      (message) =>
        `${path.relative(repositoryRoot, result.filePath)}:${message.line} ${message.message}`,
    ),
);
assert.deepEqual(
  errors,
  [],
  `Core import policy failed:\n${errors.join("\n")}`,
);

const cases = [
  {
    name: "Desktop production public subpath",
    filePath: "apps/desktop/src/architecture-proof.ts",
    source: 'import type {} from "@streamfusion/core/platform";\n',
    allowed: true,
  },
  {
    name: "Desktop test-support subpath",
    filePath: "apps/desktop/tests/architecture-proof.test.ts",
    source: 'import type {} from "@streamfusion/core/testing";\n',
    allowed: true,
  },
  {
    name: "Worker production public subpath",
    filePath: "apps/worker/src/architecture-proof.ts",
    source: 'import type {} from "@streamfusion/core/reliability";\n',
    allowed: true,
  },
  {
    name: "forbidden Desktop root import",
    filePath: "apps/desktop/src/architecture-proof.ts",
    source: 'import "@streamfusion/core";\n',
    allowed: false,
  },
  {
    name: "forbidden Desktop relative deep import",
    filePath: "apps/desktop/src/architecture-proof.ts",
    source: 'import "../../../../packages/core/src/platform/index.ts";\n',
    allowed: false,
  },
  {
    name: "forbidden Desktop test relative deep import",
    filePath: "apps/desktop/tests/architecture-proof.test.ts",
    source: 'import "../../../packages/core/src/testing/index.ts";\n',
    allowed: false,
  },
  {
    name: "forbidden Worker relative deep import",
    filePath: "apps/worker/src/architecture-proof.ts",
    source: 'import "../../../packages/core/src/reliability/index.ts";\n',
    allowed: false,
  },
  {
    name: "forbidden Worker package deep import",
    filePath: "apps/worker/src/architecture-proof.ts",
    source: 'import "@streamfusion/core/reliability/internal";\n',
    allowed: false,
  },
  {
    name: "forbidden Desktop dynamic relative deep import",
    filePath: "apps/desktop/src/architecture-proof.ts",
    source:
      'await import("../../../../packages/core/src/platform/index.ts");\n',
    allowed: false,
  },
  {
    name: "forbidden Worker CommonJS relative deep import",
    filePath: "apps/worker/src/architecture-proof.ts",
    source: 'require("../../../packages/core/src/reliability/index.ts");\n',
    allowed: false,
  },
  {
    name: "forbidden Mobile test relative deep import",
    filePath: "apps/mobile/tests/architecture-proof.test.ts",
    source: 'import "../../../packages/core/src/testing/index.ts";\n',
    allowed: false,
  },
  {
    name: "forbidden package relative deep import",
    filePath: "packages/example/src/architecture-proof.ts",
    source: 'import "../../core/src/content/index.ts";\n',
    allowed: false,
  },
  {
    name: "forbidden production test-support import",
    filePath: "apps/worker/src/architecture-proof.ts",
    source: 'import type {} from "@streamfusion/core/testing";\n',
    allowed: false,
  },
];

for (const proofCase of cases) {
  const [result] = await eslint.lintText(proofCase.source, {
    filePath: path.join(repositoryRoot, proofCase.filePath),
    warnIgnored: false,
  });
  assert.ok(result, `${proofCase.name}: ESLint returned no result`);
  const policyErrors = result.messages.filter(
    (message) =>
      message.ruleId === "streamfusion/core-import-boundary" &&
      message.severity === 2,
  );
  if (proofCase.allowed) {
    assert.equal(
      result.errorCount,
      0,
      `${proofCase.name}: ${result.messages.map((message) => message.message).join(" | ")}`,
    );
  } else {
    assert.ok(
      policyErrors.length > 0,
      `${proofCase.name}: the core import boundary did not reject the import`,
    );
  }
}

const allowedCount = cases.filter((proofCase) => proofCase.allowed).length;
const forbiddenCount = cases.length - allowedCount;
console.log(
  `Core consumer import proof passed: ${allowedCount} allowed and ${forbiddenCount} forbidden cases.`,
);
