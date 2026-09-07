import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyFeatureLayout } from "./feature-architecture.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(desktopRoot);
verifyFeatureLayout(path.join(desktopRoot, "src"));
const eslint = new ESLint({ cwd: desktopRoot });
const proofs = [
  [
    "frontend/components/dev/boundary-proof.stories.tsx",
    'import "@/features/chat/tests/stories/boundary-target";',
    undefined,
  ],
  [
    "frontend/components/dev/boundary-proof.tsx",
    'import "@/features/chat/tests/stories/boundary-target";',
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/auth/domain/boundary-proof.ts",
    'import type { Platform } from "@shared/auth-types"; export type BoundaryProof = Platform;',
    undefined,
  ],
  [
    "frontend/features/auth/domain/boundary-proof.ts",
    'import "../components/boundary-target";',
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/auth/domain/boundary-proof.ts",
    'import "@/features/auth/adapters/boundary-target";',
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/auth/capabilities/boundary-proof.ts",
    'import "../adapters/boundary-target";',
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/auth/utils/boundary-proof.ts",
    'import "react";',
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/auth/domain/boundary-proof.ts",
    'void import("../adapters/boundary-target");',
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/auth/domain/boundary-proof.ts",
    'require("@/features/auth/components/boundary-target");',
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/auth/components/boundary-proof.ts",
    'import "../tests/boundary-target";',
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/auth/adapters/boundary-proof.ts",
    'import "@backend/features/authentication/adapters/boundary-target";',
    "feature-architecture/dependencies",
  ],
  [
    "backend/features/authentication/domain/boundary-proof.ts",
    'import "../data/boundary-target";',
    "feature-architecture/dependencies",
  ],
  [
    "backend/features/authentication/domain/boundary-proof.ts",
    'import "electron";',
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/auth/composition/boundary-proof.ts",
    'import "@/features/moderation/routes";',
    undefined,
  ],
  [
    "frontend/features/auth/composition/boundary-proof.ts",
    'import "@/features/playback/routes";',
    "boundaries/dependencies",
  ],
  [
    "frontend/features/settings/components/boundary-proof.ts",
    "window.electronAPI.getVersion();",
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/settings/capabilities/boundary-proof.ts",
    "export type BoundaryProof = typeof window.electronAPI;",
    "feature-architecture/dependencies",
  ],
  [
    "frontend/features/settings/adapters/boundary-proof.ts",
    "window.electronAPI.getVersion();",
    undefined,
  ],
  [
    "frontend/features/auth/tests/boundary-proof.test.ts",
    'import "@/features/playback/routes";',
    undefined,
  ],
];
for (const [file, code, expectedRule] of proofs) {
  const [result] = await eslint.lintText(code, { filePath: path.join(desktopRoot, "src", file) });
  if (
    expectedRule
      ? !result.messages.some((message) => message.ruleId === expectedRule)
      : result.errorCount > 0
  ) {
    throw new Error(`Boundary proof failed for ${file}: ${JSON.stringify(result.messages)}`);
  }
}
process.stdout.write(`Feature layout and ${proofs.length} ESLint boundary proofs passed.\n`);
