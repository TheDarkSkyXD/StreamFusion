import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assembleReleaseSet } from "./assemble-android-release-set.mjs";
import { readEasBuild } from "./read-eas-build.mjs";

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
    easBuildId: "build-123",
    easBuildUrl: "https://expo.dev/artifacts/eas/build-123",
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
    easBuildId: "build-123",
    easBuildUrl: "https://expo.dev/artifacts/eas/build-123",
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
    easBuildId: "build-123",
    easBuildUrl: "https://expo.dev/artifacts/eas/build-123",
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
    easBuildId: "build-999",
    easBuildUrl: "https://expo.dev/artifacts/eas/build-999",
    apkFileName: APK_NAME,
  });

  const buildInfo = JSON.parse(
    readFileSync(path.join(directory, "build-info.json"), "utf8"),
  );
  assert.equal(buildInfo.applicationId, "com.thedarkskyxd.streamfusion");
  assert.equal(buildInfo.buildProfile, "production");
  assert.equal(buildInfo.easBuildId, "build-999");
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
    easBuildId: "build-123",
    easBuildUrl: "https://expo.dev/artifacts/eas/build-123",
    apkFileName: APK_NAME,
  });

  const notes = readFileSync(path.join(directory, "release-notes.md"), "utf8");
  assert.match(notes, /Android 11 \(API 30\)/u);
  assert.match(notes, /sha256sum --check SHA256SUMS/u);
  assert.match(notes, /Do not disable Play Protect/u);
  assert.match(notes, /versionCode/u);
  assert.match(notes, /not complete in this release/u);
});

test("a build from a different commit or profile is refused", () => {
  const metadata = {
    id: "build-123",
    url: "https://expo.dev/artifacts/eas/build-123",
    gitCommit: "abc123",
    buildProfile: "production",
    artifacts: [{ type: "apk", url: "https://expo.dev/artifacts/abc/app.apk" }],
  };

  assert.deepEqual(
    readEasBuild({ metadata, expectedCommit: "abc123", expectedProfile: "production" }),
    {
      build_id: "build-123",
      build_url: "https://expo.dev/artifacts/eas/build-123",
      artifact_url: "https://expo.dev/artifacts/abc/app.apk",
    },
  );
  assert.throws(
    () => readEasBuild({ metadata, expectedCommit: "different", expectedProfile: "production" }),
    /built commit abc123 but the release tag points at different/u,
  );
  assert.throws(
    () => readEasBuild({ metadata, expectedCommit: "abc123", expectedProfile: "alpha" }),
    /used profile production, expected alpha/u,
  );
  assert.throws(
    () => readEasBuild({ metadata: { id: "b" }, expectedCommit: "abc123", expectedProfile: "production" }),
    /missing git commit/u,
  );
  assert.throws(
    () => readEasBuild({ metadata: { gitCommit: "abc123", buildProfile: "production" }, expectedProfile: "production" }),
    /missing build id/u,
  );
  assert.throws(
    () =>
      readEasBuild({
        metadata: { id: "b", gitCommit: "abc123", buildProfile: "production", artifacts: [] },
        expectedProfile: "production",
      }),
    /missing artifact URL/u,
  );
});

test("the release helpers the workflow calls all exist", () => {
  for (const file of [
    "scripts/assemble-android-release-set.mjs",
    "scripts/read-eas-build.mjs",
    ".github/workflows/android-release.yml",
  ]) {
    assert.ok(existsSync(file), `${file} is referenced but missing`);
  }
});
