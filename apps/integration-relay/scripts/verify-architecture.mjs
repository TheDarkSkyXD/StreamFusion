import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const relayRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const configFile = path.join(relayRoot, "eslint.config.mjs");
const cases = [
  {
    name: "composition may import transport",
    file: "src/composition/architecture-proof-allowed.ts",
    source: 'import "../transport/not-found";\n',
    allowed: true
  },
  {
    name: "transport may not import composition",
    file: "src/transport/architecture-proof-reverse.ts",
    source: 'import "../composition/worker";\n',
    ruleId: "boundaries/dependencies"
  },
  {
    name: "relay may not deep import core",
    file: "src/transport/architecture-proof-deep-core.ts",
    source: 'import "@streamfusion/core/src/relay/index.ts";\n',
    ruleId: "no-restricted-imports"
  },
  {
    name: "relay may not import core testing",
    file: "src/transport/architecture-proof-core-testing.ts",
    source: 'import "@streamfusion/core/testing";\n',
    ruleId: "no-restricted-imports"
  },
  {
    name: "transport may not import provider SDKs",
    file: "src/transport/architecture-proof-provider.ts",
    source: 'import "firebase-admin";\n',
    ruleId: "no-restricted-imports"
  },
  {
    name: "relay may not import Mobile source",
    file: "src/transport/architecture-proof-mobile.ts",
    source: 'import "../../../mobile/app/index";\n',
    ruleId: "no-restricted-imports"
  }
];

const eslint = new ESLint({ cwd: relayRoot, overrideConfigFile: configFile });
const createdFiles = cases.map(({ file }) => path.join(relayRoot, file));

try {
  for (const testCase of cases) {
    const target = path.join(relayRoot, testCase.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, testCase.source, "utf8");
    const [result] = await eslint.lintFiles([target]);
    assert.ok(result, `${testCase.name}: ESLint returned no result`);

    if (testCase.allowed) {
      assert.equal(
        result.errorCount,
        0,
        `${testCase.name}: ${result.messages.map(({ message }) => message).join("; ")}`
      );
      continue;
    }

    assert.ok(
      result.messages.some(({ ruleId }) => ruleId === testCase.ruleId),
      `${testCase.name}: expected ${testCase.ruleId}, got ${result.messages
        .map(({ ruleId }) => ruleId)
        .join(", ")}`
    );
  }
} finally {
  await Promise.all(createdFiles.map((file) => rm(file, { force: true })));
}

const allowedCount = cases.filter(({ allowed }) => allowed).length;
console.log(
  `Architecture import proof passed with ${allowedCount} allowed and ${cases.length - allowedCount} forbidden cases.`
);
