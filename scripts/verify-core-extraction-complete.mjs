import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const publicSubpaths = [
  "platform",
  "content",
  "discovery",
  "follows",
  "auth",
  "chat",
  "reliability",
  "relay",
  "testing",
];

const contractSuites = {
  platform: "packages/core/tests/platform.test.mjs",
  content: "packages/core/tests/content.test.mjs",
  discovery: "packages/core/tests/discovery.test.mjs",
  follows: "packages/core/tests/follows.test.mjs",
  auth: "packages/core/tests/auth.test.mjs",
  chat: "packages/core/tests/chat.test.mjs",
  reliability: "packages/core/tests/reliability.test.mjs",
  relay: "apps/integration-relay/tests/envelopes.test.ts",
};

const compatibilityAliases = new Map([
  [
    "apps/desktop/src/shared/auth-types.ts",
    [
      "Platform",
      "FollowSource",
      "NotificationPreferences",
      "DEFAULT_NOTIFICATION_PREFERENCES",
    ],
  ],
  [
    "apps/desktop/src/shared/chat-types.ts",
    [
      "ChatPlatform",
      "ChatBadge",
      "MessageType",
      "ChatHighlightKind",
      "ContentFragment",
      "ReplyInfo",
    ],
  ],
  [
    "apps/desktop/src/shared/search-types.ts",
    [
      "SearchResultType",
      "SearchLimits",
      "SearchIntent",
      "StreamSearchEndReason",
    ],
  ],
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [entryPath] : [];
  });
}

function relative(root, filePath) {
  return path.relative(root, filePath).replaceAll("\\", "/");
}

export function findExtractionViolations(root = repositoryRoot) {
  const violations = [];
  const desktopSource = path.join(root, "apps/desktop/src");
  const directCoreReexport =
    /export\s+(?:type\s+)?(?:\*[^;]*|\{[^}]*\})\s+from\s+["']@streamfusion\/core\//gsu;

  for (const filePath of sourceFiles(desktopSource)) {
    const source = readFileSync(filePath, "utf8");
    if (directCoreReexport.test(source)) {
      violations.push(
        `${relative(root, filePath)} re-exports a Core public API`,
      );
    }
    directCoreReexport.lastIndex = 0;
  }

  for (const [fileName, names] of compatibilityAliases) {
    const source = readFileSync(path.join(root, fileName), "utf8");
    for (const name of names) {
      const alias = new RegExp(`export\\s+(?:type|const)\\s+${name}\\b`, "u");
      if (alias.test(source)) {
        violations.push(`${fileName} republishes portable type ${name}`);
      }
    }
  }

  const migrationShimDirectory = path.join(
    root,
    "packages/core/src/migration-shims",
  );
  if (existsSync(migrationShimDirectory)) {
    violations.push("packages/core/src/migration-shims still exists");
  }

  for (const fileName of [
    "packages/core/eslint.config.mjs",
    "packages/core/scripts/verify-architecture.mjs",
  ]) {
    const source = readFileSync(path.join(root, fileName), "utf8");
    if (/migration-shims?/u.test(source)) {
      violations.push(`${fileName} still contains a migration-shim exception`);
    }
  }

  const corePackage = JSON.parse(
    readFileSync(path.join(root, "packages/core/package.json"), "utf8"),
  );
  assert.deepEqual(
    Object.keys(corePackage.exports).sort(),
    publicSubpaths.map((subpath) => `./${subpath}`).sort(),
    "Core public subpaths drifted from the approved extraction boundary",
  );

  for (const [subpath, suite] of Object.entries(contractSuites)) {
    if (!existsSync(path.join(root, suite))) {
      violations.push(
        `${subpath} has no adapter or contract suite at ${suite}`,
      );
    }
  }

  return violations;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const violations = findExtractionViolations();
  assert.deepEqual(
    violations,
    [],
    `Core extraction is incomplete:\n${violations.join("\n")}`,
  );
  console.log(
    `Core extraction complete: ${publicSubpaths.length} public subpaths, ${Object.keys(contractSuites).length} contract suites, zero compatibility re-exports, and zero migration exceptions.`,
  );
}
