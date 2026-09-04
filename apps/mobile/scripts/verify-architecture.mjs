import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const mobileRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const configFile = path.join(mobileRoot, "eslint.config.mjs");
const targetSource = "export const architectureProof = true;\n";
const targets = [
  "src/features/architecture-proof-target.ts",
  "src/design/architecture-proof-target.ts",
  "src/foundations/architecture-proof-target.ts",
  "src/capabilities/architecture-proof-target.ts",
  "src/transport/architecture-proof-target.ts",
  "src/adapters/architecture-proof-target.ts",
  "src/persistence/architecture-proof-target.ts",
  "src/native/architecture-proof-target.ts",
  "src/composition/architecture-proof-target.ts",
  "tests/architecture-proof-target.ts",
];
const cases = [
  {
    name: "route entry may call the composition root",
    file: "app/architecture-proof-entry.ts",
    source: 'import "@mobile/composition/architecture-proof-target";\n',
    allowed: true,
  },
  {
    name: "feature controller may consume a capability",
    file: "src/features/architecture-proof-capability.ts",
    source: 'import "@mobile/capabilities/architecture-proof-target";\n',
    allowed: true,
  },
  {
    name: "composition may wire a consumer and concrete implementations",
    file: "src/composition/architecture-proof-wiring.ts",
    source:
      'import "../features/architecture-proof-target";\nimport "../adapters/architecture-proof-target";\nimport "../transport/architecture-proof-target";\nimport "../persistence/architecture-proof-target";\n',
    allowed: true,
  },
  {
    name: "adapter may consume a native bridge",
    file: "src/adapters/architecture-proof-native.ts",
    source: 'import "../native/architecture-proof-target";\n',
    allowed: true,
  },
  {
    name: "persistence may consume a capability",
    file: "src/persistence/architecture-proof-capability.ts",
    source: 'import "../capabilities/architecture-proof-target";\n',
    allowed: true,
  },
  {
    name: "transport may consume a public core contract",
    file: "src/transport/architecture-proof-core.ts",
    source:
      'import type { Platform } from "@streamfusion/core/platform";\nexport type ProofPlatform = Platform;\n',
    allowed: true,
  },
  {
    name: "tests may consume Mobile production code",
    file: "tests/architecture-proof-feature.ts",
    source: 'import "../src/features/architecture-proof-target";\n',
    allowed: true,
  },
  {
    name: "feature may not import an adapter by alias",
    file: "src/features/architecture-proof-adapter-alias.ts",
    source: 'import "@mobile/adapters/architecture-proof-target";\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "feature may not import an adapter by relative path",
    file: "src/features/architecture-proof-adapter-relative.ts",
    source: 'import "../adapters/architecture-proof-target";\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "feature may not dynamically import an adapter",
    file: "src/features/architecture-proof-adapter-dynamic.ts",
    source: 'await import("@mobile/adapters/architecture-proof-target");\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "feature may not require an adapter",
    file: "src/features/architecture-proof-adapter-require.ts",
    source: 'require("@mobile/adapters/architecture-proof-target");\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "transport may not import feature UI",
    file: "src/transport/architecture-proof-feature.ts",
    source: 'import "../features/architecture-proof-target";\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "adapter may not import feature UI",
    file: "src/adapters/architecture-proof-feature.ts",
    source: 'import "../features/architecture-proof-target";\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "persistence may not import an adapter",
    file: "src/persistence/architecture-proof-adapter.ts",
    source: 'import "../adapters/architecture-proof-target";\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "native bridge may not import an adapter",
    file: "src/native/architecture-proof-adapter.ts",
    source: 'import "../adapters/architecture-proof-target";\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "foundation may not import feature UI",
    file: "src/foundations/architecture-proof-feature.ts",
    source: 'import "../features/architecture-proof-target";\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "route entry may not import an adapter",
    file: "app/architecture-proof-adapter.ts",
    source: 'import "@mobile/adapters/architecture-proof-target";\n',
    ruleId: "boundaries/dependencies",
  },
  {
    name: "feature may not import a native Expo API",
    file: "src/features/architecture-proof-expo.ts",
    source: 'import "expo-constants";\n',
    ruleId: "no-restricted-imports",
  },
  {
    name: "capability may not import React Native",
    file: "src/capabilities/architecture-proof-react-native.ts",
    source: 'import "react-native";\n',
    ruleId: "no-restricted-imports",
  },
  {
    name: "production may not import test support",
    file: "src/features/architecture-proof-test.ts",
    source: 'import "../../tests/architecture-proof-target";\n',
    ruleId: "no-restricted-imports",
  },
  {
    name: "Mobile may not deep import core",
    file: "src/features/architecture-proof-core-deep.ts",
    source: 'import "@streamfusion/core/src/platform/index.ts";\n',
    ruleId: "no-restricted-imports",
  },
  {
    name: "Mobile production may not import Node runtime APIs",
    file: "src/native/architecture-proof-node.ts",
    source: 'import "node:fs";\n',
    ruleId: "no-restricted-imports",
  },
  {
    name: "feature may not import a provider SDK",
    file: "src/features/architecture-proof-provider.ts",
    source: 'import "tmi.js";\n',
    ruleId: "no-restricted-imports",
  },
];

const files = [...targets, ...cases.map(({ file }) => file)].map((file) =>
  path.join(mobileRoot, file),
);
const eslint = new ESLint({ cwd: mobileRoot, overrideConfigFile: configFile });

try {
  for (const target of targets) {
    const targetPath = path.join(mobileRoot, target);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, targetSource, "utf8");
  }

  for (const proofCase of cases) {
    const proofPath = path.join(mobileRoot, proofCase.file);
    await mkdir(path.dirname(proofPath), { recursive: true });
    await writeFile(proofPath, proofCase.source, "utf8");
    const [result] = await eslint.lintFiles([proofPath]);
    assert.ok(result, `${proofCase.name}: ESLint returned no result`);

    if (proofCase.allowed) {
      assert.equal(
        result.errorCount,
        0,
        `${proofCase.name}: ${result.messages.map(({ message }) => message).join("; ")}`,
      );
      assert.equal(
        result.warningCount,
        0,
        `${proofCase.name}: emitted a warning`,
      );
      continue;
    }

    assert.ok(
      result.messages.some(({ ruleId }) => ruleId === proofCase.ruleId),
      `${proofCase.name}: expected ${proofCase.ruleId}, got ${result.messages
        .map(({ ruleId }) => ruleId)
        .join(", ")}`,
    );
  }
} finally {
  await Promise.all(files.map((file) => rm(file, { force: true })));
}

const allowedCount = cases.filter(({ allowed }) => allowed).length;
console.log(
  `Mobile architecture import proof passed with ${allowedCount} allowed and ${cases.length - allowedCount} forbidden cases.`,
);
