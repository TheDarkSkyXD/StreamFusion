import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import { validateMobileReleaseTag, validateReleaseTag } from "./release-policy.mjs";

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

test("a mobile tag carries the android namespace and its own version line", () => {
  assert.deepEqual(validateMobileReleaseTag({ tag: "android-v0.1.0-alpha", version: "0.1.0-alpha" }), {
    version: "0.1.0-alpha",
    prerelease: true,
    prereleaseLabel: "Alpha",
  });
  assert.deepEqual(validateMobileReleaseTag({ tag: "android-v1.0.0", version: "1.0.0" }), {
    version: "1.0.0",
    prerelease: false,
    prereleaseLabel: "",
  });
});

test("a mobile tag cannot be published through the desktop namespace", () => {
  assert.throws(
    () => validateMobileReleaseTag({ tag: "v0.1.0-alpha", version: "0.1.0-alpha" }),
    /must exactly match mobile version android-v0\.1\.0-alpha/
  );
  assert.throws(
    () => validateReleaseTag({ tag: "android-v1.0.0", version: "1.0.0" }),
    /must exactly match desktop version/
  );
});

test("a mobile version without the android prefix is rejected", () => {
  assert.throws(
    () => validateMobileReleaseTag({ tag: "android-v0.1.0", version: "0.1.0-alpha" }),
    /must exactly match mobile version/
  );
});

test("a mobile version is validated independently of the desktop version", () => {
  const desktop = JSON.parse(readFileSync("apps/desktop/package.json", "utf8")).version;
  const mobile = JSON.parse(readFileSync("apps/mobile/package.json", "utf8")).version;

  assert.notEqual(mobile, desktop, "the two apps version independently");
  assert.doesNotThrow(() => validateMobileReleaseTag({ tag: `android-v${mobile}`, version: mobile }));
  assert.throws(() => validateReleaseTag({ tag: `v${mobile}`, version: desktop }));
});

test("an unsupported mobile version shape is rejected", () => {
  for (const version of ["0.1", "0.1.0.0", "0.1.0-nightly", "v0.1.0", "0.1.0-alpha.beta"]) {
    assert.throws(
      () => validateMobileReleaseTag({ tag: `android-v${version}`, version }),
      /unsupported mobile release version/
    );
  }
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
    assert.match(await readFile(outputPath, "utf8"), /product=desktop/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("CLI resolves a mobile tag against the mobile package version", async () => {
  const version = JSON.parse(readFileSync("apps/mobile/package.json", "utf8")).version;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "streamfusion-mobile-release-policy-"));
  const outputPath = path.join(temporaryDirectory, "github-output.txt");

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-policy.mjs", `android-v${version}`, outputPath],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    const output = await readFile(outputPath, "utf8");
    assert.match(output, new RegExp(`version=${version}`));
    assert.match(output, /product=mobile/);
    assert.ok(
      output.split("\n").includes(`prerelease=${version.includes("-")}`),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("CLI rejects a mobile version published without the android prefix", async () => {
  const version = JSON.parse(readFileSync("apps/mobile/package.json", "utf8")).version;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "streamfusion-mobile-release-policy-"));
  const outputPath = path.join(temporaryDirectory, "github-output.txt");

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-policy.mjs", `v${version}`, outputPath],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /must exactly match desktop version/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
