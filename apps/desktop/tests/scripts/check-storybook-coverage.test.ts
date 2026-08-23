import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildCoverageReport } from "../../scripts/check-storybook-coverage.mjs";

const sourceRoot = path.join("C:", "workspace", "src");

function sourceFile(relativePath: string) {
  return path.join(sourceRoot, ...relativePath.split("/"));
}

// Guards: every Storybook-eligible React module across src must report its missing same-basename story using a path relative to src.
// Guards: a collocated same-basename story must cover its React module instead of being reported as missing.
describe("check-storybook-coverage", () => {
  it("reports src-relative missing modules while recognizing collocated stories", async () => {
    const report = await buildCoverageReport({
      rootDirectory: sourceRoot,
      collectFiles: async () => [
        sourceFile("components/Player.tsx"),
        sourceFile("components/Player.stories.tsx"),
        sourceFile("pages/Watch.tsx"),
      ],
      exclusions: {},
    });

    expect(report.componentCount).toBe(2);
    expect(report.coveredCount).toBe(1);
    expect(report.missingComponents).toEqual(["pages/Watch.tsx"]);
    expect(report.orphanStories).toEqual([]);
  });

  it("accepts a src-relative nonvisual exclusion", async () => {
    const report = await buildCoverageReport({
      rootDirectory: sourceRoot,
      collectFiles: async () => [sourceFile("renderer.tsx")],
      exclusions: {
        "renderer.tsx": "DOM bootstrap has no standalone visual surface for a Storybook story.",
      },
    });

    expect(report.missingComponents).toEqual([]);
    expect(report.exclusionErrors).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("rejects exclusions outside the src-relative path namespace", async () => {
    const report = await buildCoverageReport({
      rootDirectory: sourceRoot,
      collectFiles: async () => [sourceFile("renderer.tsx")],
      exclusions: {
        "../renderer.tsx": "DOM bootstrap has no standalone visual surface for a Storybook story.",
      },
    });

    expect(report.exclusionErrors).toEqual(["../renderer.tsx: is not a valid React module path."]);
  });
});
