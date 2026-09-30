import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const PRODUCTION_APPLICATION_ID = "com.thedarkskyxd.streamfusion";
const MINIMUM_SDK = 30;
const UPDATE_MANIFEST_SCHEMA_VERSION = 1;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * The Android Release Set is the immutable group of artifacts published for one
 * Public Android Release: the signed APK, the updater manifest, checksums, the
 * build record, and release notes. Every number here is measured from the APK
 * that was actually built, never restated from the tag.
 */
export function assembleReleaseSet({
  directory,
  releaseTag,
  version,
  prerelease,
  versionCode,
  commitSha,
  runUrl,
  apkFileName,
}) {
  const apkPath = path.join(directory, apkFileName);
  const apk = readFileSync(apkPath);
  const digest = sha256(apk);

  const updateManifest = {
    schemaVersion: UPDATE_MANIFEST_SCHEMA_VERSION,
    releaseTag,
    versionName: version,
    versionCode,
    assetName: apkFileName,
    sha256: digest,
    byteLength: apk.byteLength,
    minSdk: MINIMUM_SDK,
    mandatory: false,
  };
  writeFileSync(
    path.join(directory, "android-update.json"),
    `${JSON.stringify(updateManifest, null, 2)}\n`,
  );

  const buildInfo = {
    releaseTag,
    commitSha,
    buildRunUrl: runUrl,
    buildProfile: "production",
    builder: "github-actions",
    toolchain: "gradlew app:assembleRelease on ubuntu-latest",
    expoSdk: "57",
    applicationId: PRODUCTION_APPLICATION_ID,
    versionName: version,
    versionCode,
    minSdk: MINIMUM_SDK,
    prerelease: prerelease === "true",
    assetName: apkFileName,
    sha256: digest,
    byteLength: apk.byteLength,
  };
  writeFileSync(
    path.join(directory, "build-info.json"),
    `${JSON.stringify(buildInfo, null, 2)}\n`,
  );

  const notes = [
    `# StreamFusion Android ${version}`,
    "",
    prerelease === "true"
      ? "This is a prerelease. It is signed with the StreamFusion Mobile production key, but Twitch and Kick sign-in are still being finished."
      : "This is a stable release.",
    "",
    "## Install",
    "",
    `1. Download \`${apkFileName}\` from this release on an Android 11 (API 30) or newer device.`,
    "2. Open the downloaded file. Android asks you to allow your browser to install unknown apps.",
    "3. Confirm the install. The app is named StreamFusion.",
    "4. Revoke the browser install permission afterwards if you do not want it kept.",
    "",
    "Do not disable Play Protect. Unverified installs are restricted on certified devices.",
    "",
    "## Verify the download",
    "",
    "```bash",
    "sha256sum --check SHA256SUMS",
    "```",
    "",
    "The APK is signed with the StreamFusion Mobile production key. Android only accepts an update whose signing certificate and `versionCode` match the installed app, so never uninstall before installing a newer release.",
    "",
    "## Known issues",
    "",
    "- Twitch and Kick account sign-in is not complete in this release.",
    "- The in-app updater is not available yet; install new versions from this page.",
  ].join("\n");
  writeFileSync(path.join(directory, "release-notes.md"), `${notes}\n`);

  const checksummed = [
    apkFileName,
    "android-update.json",
    "build-info.json",
    "release-notes.md",
  ].map((name) => `${sha256(readFileSync(path.join(directory, name)))}  ${name}`);
  writeFileSync(path.join(directory, "SHA256SUMS"), `${checksummed.join("\n")}\n`);

  return { ...updateManifest, files: readdirSync(directory).sort() };
}

function runCli() {
  const [, , directory, releaseTag, version, prerelease, versionCode, commitSha, runUrl] =
    process.argv;
  if (!directory || !releaseTag || !version || !versionCode) {
    throw new Error(
      "usage: node scripts/assemble-android-release-set.mjs <directory> <release-tag> <version> <prerelease> <version-code> <commit-sha> <build-run-url>",
    );
  }

  const apkFileName = readdirSync(directory).find(
    (name) => name.startsWith("StreamFusion-android-") && name.endsWith(".apk"),
  );
  if (!apkFileName) {
    throw new Error(`No StreamFusion Android APK found in ${directory}`);
  }

  const result = assembleReleaseSet({
    directory,
    releaseTag,
    version,
    prerelease,
    versionCode: Number(versionCode),
    commitSha: commitSha || "unknown",
    runUrl: runUrl || "unknown",
    apkFileName,
  });
  console.log(
    `Assembled the Android Release Set for ${releaseTag}: ${result.files.join(", ")}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
