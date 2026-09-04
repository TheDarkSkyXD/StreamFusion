import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const coreRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(coreRoot, "../..");
const sourceRoot = path.join(coreRoot, "src");
const proofLayers = [
  "foundations",
  "capabilities",
  "use-cases",
  "platform",
  "testing",
];

function proofDirectory(layer) {
  return path.join(sourceRoot, layer);
}

function writeProof(layer, fileName, source) {
  const filePath = path.join(proofDirectory(layer), fileName);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, source, "utf8");
  return filePath;
}

function clearProofDirectories() {
  for (const layer of proofLayers) {
    const directory = proofDirectory(layer);
    if (!existsSync(directory)) {
      continue;
    }
    for (const fileName of readdirSync(directory)) {
      if (fileName.startsWith("architecture-proof-")) {
        rmSync(path.join(directory, fileName), { force: true });
      }
    }
  }
}

function importPath(fromDirectory, targetPath) {
  const relativePath = path
    .relative(fromDirectory, targetPath)
    .replaceAll("\\", "/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

clearProofDirectories();

try {
  const foundation = writeProof(
    "foundations",
    "architecture-proof-target.ts",
    "export const foundationProof = true;\n",
  );
  const capability = writeProof(
    "capabilities",
    "architecture-proof-target.ts",
    'import { foundationProof } from "@core/foundations/architecture-proof-target";\nexport const capabilityProof = foundationProof;\n',
  );
  const capabilityImport = importPath(proofDirectory("use-cases"), capability);
  const useCase = writeProof(
    "use-cases",
    "architecture-proof-target.ts",
    `import { capabilityProof } from "${capabilityImport}";\nexport const useCaseProof = capabilityProof;\n`,
  );
  const testing = writeProof(
    "testing",
    "architecture-proof-target.ts",
    "export const testingProof = true;\n",
  );

  const platformProofDirectory = proofDirectory("platform");
  const desktopTarget = path.join(
    repositoryRoot,
    "apps",
    "desktop",
    "src",
    "shared",
    "platform-types.ts",
  );
  const appImport = importPath(platformProofDirectory, desktopTarget);

  const cases = [
    {
      name: "foundation without imports",
      allowed: true,
      file: foundation,
    },
    {
      name: "capability-to-foundation alias",
      allowed: true,
      file: capability,
    },
    {
      name: "use-case-to-capability relative import",
      allowed: true,
      file: useCase,
    },
    {
      name: "forbidden reverse relative import",
      allowed: false,
      file: writeProof(
        "foundations",
        "architecture-proof-forbidden-relative.ts",
        `import "${importPath(proofDirectory("foundations"), capability)}";\n`,
      ),
    },
    {
      name: "forbidden reverse alias import",
      allowed: false,
      file: writeProof(
        "foundations",
        "architecture-proof-forbidden-alias.ts",
        'import "@core/capabilities/architecture-proof-target";\n',
      ),
    },
    {
      name: "forbidden dynamic import",
      allowed: false,
      file: writeProof(
        "foundations",
        "architecture-proof-forbidden-dynamic.ts",
        'await import("@core/capabilities/architecture-proof-target");\n',
      ),
    },
    {
      name: "forbidden CommonJS import",
      allowed: false,
      file: writeProof(
        "foundations",
        "architecture-proof-forbidden-require.ts",
        'require("@core/capabilities/architecture-proof-target");\n',
      ),
    },
    {
      name: "forbidden Node runtime import",
      allowed: false,
      file: writeProof(
        "foundations",
        "architecture-proof-forbidden-runtime.ts",
        'import "node:fs";\n',
      ),
    },
    {
      name: "forbidden provider SDK import",
      allowed: false,
      file: writeProof(
        "foundations",
        "architecture-proof-forbidden-provider.ts",
        'import "tmi.js";\n',
      ),
    },
    {
      name: "forbidden app-source import",
      allowed: false,
      file: writeProof(
        "platform",
        "architecture-proof-forbidden-app.ts",
        `import "${appImport}";\n`,
      ),
    },
    {
      name: "forbidden package deep import",
      allowed: false,
      file: writeProof(
        "platform",
        "architecture-proof-forbidden-deep.ts",
        'import "@streamfusion/core/src/platform/index.ts";\n',
      ),
    },
    {
      name: "forbidden production test-support import",
      allowed: false,
      file: writeProof(
        "platform",
        "architecture-proof-forbidden-testing.ts",
        `import "${importPath(platformProofDirectory, testing)}";\n`,
      ),
    },
  ];

  const eslint = new ESLint({
    cwd: coreRoot,
    overrideConfigFile: path.join(coreRoot, "eslint.config.mjs"),
  });

  for (const proofCase of cases) {
    const [result] = await eslint.lintFiles([proofCase.file]);
    assert.ok(result, `${proofCase.name}: ESLint returned no result`);
    const boundaryErrors = result.messages.filter(
      (message) =>
        message.ruleId === "boundaries/dependencies" && message.severity === 2,
    );
    if (proofCase.allowed) {
      assert.equal(
        result.errorCount,
        0,
        `${proofCase.name}: ${result.messages.map((message) => message.message).join(" | ")}`,
      );
      assert.equal(
        result.warningCount,
        0,
        `${proofCase.name}: emitted a warning`,
      );
    } else {
      assert.ok(
        boundaryErrors.length > 0,
        `${proofCase.name}: boundaries/dependencies did not reject the import`,
      );
    }
  }

  const allowedCount = cases.filter((proofCase) => proofCase.allowed).length;
  const forbiddenCount = cases.length - allowedCount;
  console.log(
    `Architecture import proof passed: ${allowedCount} allowed and ${forbiddenCount} forbidden cases.`,
  );
} finally {
  clearProofDirectories();
}
