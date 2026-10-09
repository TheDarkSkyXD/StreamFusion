import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assembleReleaseSet } from "./assemble-android-release-set.mjs";

const APK_NAME = "StreamFusion-android-v0.1.0-alpha.apk";
const APK_BYTES = Buffer.from("pretend this is a signed apk");

function releaseSetDirectory() {
  const directory = mkdtempSync(path.join(tmpdir(), "android-release-set-"));
  writeFileSync(path.join(directory, APK_NAME), APK_BYTES);
  return directory;
}

test("the release set carries the APK, its manifest, checksums, and build record", () => {
  const directory = releaseSetDirectory();

  const result = assembleReleaseSet({
    directory,
    releaseTag: "android-v0.1.0-alpha",
    version: "0.1.0-alpha",
    prerelease: "true",
    versionCode: 7,
    commitSha: "abc123", runUrl: "https://github.com/o/r/actions/runs/1",
    apkFileName: APK_NAME,
  });

  assert.deepEqual(result.files, [
    "SHA256SUMS",
    APK_NAME,
    "android-update.json",
    "build-info.json",
    "release-notes.md",
  ]);
});

test("the updater manifest describes the bytes that were actually built", () => {
  const directory = releaseSetDirectory();

  assembleReleaseSet({
    directory,
    releaseTag: "android-v0.1.0-alpha",
    version: "0.1.0-alpha",
    prerelease: "true",
    versionCode: 7,
    commitSha: "abc123", runUrl: "https://github.com/o/r/actions/runs/1",
    apkFileName: APK_NAME,
  });

  const manifest = JSON.parse(
    readFileSync(path.join(directory, "android-update.json"), "utf8"),
  );
  const expectedDigest = createHash("sha256").update(APK_BYTES).digest("hex");

  assert.equal(manifest.releaseTag, "android-v0.1.0-alpha");
  assert.equal(manifest.versionName, "0.1.0-alpha");
  assert.equal(manifest.versionCode, 7);
  assert.equal(manifest.assetName, APK_NAME);
  assert.equal(manifest.sha256, expectedDigest);
  assert.equal(manifest.byteLength, APK_BYTES.byteLength);
  assert.equal(manifest.minSdk, 30);
  assert.equal(manifest.mandatory, false, "StreamFusion never forces an update");
  assert.doesNotMatch(
    JSON.stringify(manifest),
    /https?:\/\//u,
    "the updater manifest must not carry executable URLs",
  );
});

test("the checksums file matches every other file byte for byte", () => {
  const directory = releaseSetDirectory();

  assembleReleaseSet({
    directory,
    releaseTag: "android-v0.1.0-alpha",
    version: "0.1.0-alpha",
    prerelease: "true",
    versionCode: 7,
    commitSha: "abc123", runUrl: "https://github.com/o/r/actions/runs/1",
    apkFileName: APK_NAME,
  });

  const lines = readFileSync(path.join(directory, "SHA256SUMS"), "utf8")
    .trim()
    .split("\n");
  assert.deepEqual(
    lines.map((line) => line.split("  ")[1]).sort(),
    [APK_NAME, "android-update.json", "build-info.json", "release-notes.md"],
  );
  for (const line of lines) {
    const [digest, name] = line.split("  ");
    assert.equal(
      digest,
      createHash("sha256").update(readFileSync(path.join(directory, name))).digest("hex"),
      `${name} checksum does not match its bytes`,
    );
  }
});

test("the build record names the production application id and the EAS build", () => {
  const directory = releaseSetDirectory();

  assembleReleaseSet({
    directory,
    releaseTag: "android-v1.0.0",
    version: "1.0.0",
    prerelease: "false",
    versionCode: 12,
    commitSha: "def456",
    runUrl: "https://github.com/o/r/actions/runs/2",
    apkFileName: APK_NAME,
  });

  const buildInfo = JSON.parse(
    readFileSync(path.join(directory, "build-info.json"), "utf8"),
  );
  assert.equal(buildInfo.applicationId, "com.thedarkskyxd.streamfusion");
  assert.equal(buildInfo.buildProfile, "production");
  assert.equal(buildInfo.builder, "github-actions");
  assert.equal(buildInfo.commitSha, "def456");
  assert.equal(buildInfo.buildRunUrl, "https://github.com/o/r/actions/runs/2");
  assert.equal(buildInfo.versionCode, 12);
  assert.equal(buildInfo.prerelease, false);
});

test("the release notes tell a first-time user how to install", () => {
  const directory = releaseSetDirectory();

  assembleReleaseSet({
    directory,
    releaseTag: "android-v0.1.0-alpha",
    version: "0.1.0-alpha",
    prerelease: "true",
    versionCode: 1,
    commitSha: "abc123", runUrl: "https://github.com/o/r/actions/runs/1",
    apkFileName: APK_NAME,
  });

  const notes = readFileSync(path.join(directory, "release-notes.md"), "utf8");
  assert.match(notes, /Android 11 \(API 30\)/u);
  assert.match(notes, /sha256sum --check SHA256SUMS/u);
  assert.match(notes, /Do not disable Play Protect/u);
  assert.match(notes, /versionCode/u);
  assert.match(notes, /not complete in this release/u);
});

test("release-specific notes survive assembly and have a matching checksum", () => {
  const directory = releaseSetDirectory();
  const notes = "# StreamFusion Android 0.1.8\n\nTwitch and Kick sign-in is available.\n";
  writeFileSync(path.join(directory, "release-notes.md"), notes);

  assembleReleaseSet({
    directory,
    releaseTag: "android-v0.1.8",
    version: "0.1.8",
    prerelease: "false",
    versionCode: 11,
    commitSha: "abc123",
    runUrl: "https://github.com/o/r/actions/runs/1",
    apkFileName: APK_NAME,
  });

  assert.equal(readFileSync(path.join(directory, "release-notes.md"), "utf8"), notes);
  const digest = createHash("sha256").update(notes).digest("hex");
  assert.ok(
    readFileSync(path.join(directory, "SHA256SUMS"), "utf8")
      .split("\n")
      .includes(`${digest}  release-notes.md`),
  );
});

test("the release helpers the workflow calls all exist", () => {
  for (const file of [
    "scripts/assemble-android-release-set.mjs",
    ".github/workflows/android-release.yml",
  ]) {
    assert.ok(existsSync(file), `${file} is referenced but missing`);
  }
  assert.equal(
    existsSync("scripts/read-eas-build.mjs"),
    false,
    "the release now builds on the runner, so the EAS metadata reader is dead weight",
  );
});
