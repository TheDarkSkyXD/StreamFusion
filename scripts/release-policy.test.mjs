import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import { validateReleaseTag } from "./release-policy.mjs";

test("accepts a stable tag that exactly matches the desktop package version", () => {
  assert.deepEqual(validateReleaseTag({ tag: "v1.2.3", version: "1.2.3" }), {
    version: "1.2.3",
    prerelease: false,
    prereleaseLabel: "",
  });
});

test("accepts supported prerelease tags and identifies their release label", () => {
  assert.deepEqual(validateReleaseTag({ tag: "v2.0.0-rc.3", version: "2.0.0-rc.3" }), {
    version: "2.0.0-rc.3",
    prerelease: true,
    prereleaseLabel: "Release Candidate",
  });
});

test("rejects a tag that does not exactly match the desktop package version", () => {
  assert.throws(
    () => validateReleaseTag({ tag: "v1.2.4", version: "1.2.3" }),
    /must exactly match desktop version v1\.2\.3/
  );
});

test("CLI validates the repository version and writes GitHub Actions outputs", async () => {
  const version = JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "streamfusion-release-policy-"));
  const outputPath = path.join(temporaryDirectory, "github-output.txt");

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-policy.mjs", `v${version}`, outputPath],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(outputPath, "utf8"), new RegExp(`version=${version}`));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
