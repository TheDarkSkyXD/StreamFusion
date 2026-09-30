import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflowSource = readFileSync(".github/workflows/android-release.yml", "utf8");
const verifySource = readFileSync("apps/mobile/scripts/verify-release.mjs", "utf8");
const PINNED = JSON.parse(
  readFileSync("apps/mobile/config/production-signing-certificate.json", "utf8"),
);

/** The YAML block for one named step, up to the next step. */
function stepBlock(name) {
  const start = workflowSource.indexOf(`- name: ${name}\n`);
  if (start < 0) return null;
  const rest = workflowSource.slice(start + 1);
  const next = rest.indexOf("\n      - name:");
  return next < 0 ? rest : rest.slice(0, next);
}

test("prebuild runs with the production identity in the environment", () => {
  const prebuild = stepBlock("Prebuild the Android project");

  assert.ok(prebuild, "the workflow must prebuild the Android project");
  assert.match(prebuild, /STREAMFUSION_RELEASE_CHANNEL: production/u);
  for (const variable of [
    "STREAMFUSION_PRODUCTION_EAS_PROJECT_ID",
    "STREAMFUSION_PRODUCTION_EAS_OWNER",
    "STREAMFUSION_PRODUCTION_VERSION",
    "STREAMFUSION_PRODUCTION_VERSION_CODE",
  ]) {
    assert.match(prebuild, new RegExp(variable, "u"), `${variable} must reach prebuild`);
  }
});

test("the generated project is proven to carry the public identity before Gradle runs", () => {
  const check = stepBlock("Require the production identity in the generated project");

  assert.ok(check, "a release must not build from a project that still has the development application id");
  assert.match(check, /com\.thedarkskyxd\.streamfusion['"]/u);
  assert.doesNotMatch(check, /streamfusion\.dev/u);
  assert.match(check, /build\.gradle/u, "the check must read the generated project");
  assert.ok(
    workflowSource.indexOf("- name: Prebuild the Android project")
      < workflowSource.indexOf("- name: Require the production identity in the generated project"),
  );
  assert.ok(
    workflowSource.indexOf("- name: Require the production identity in the generated project")
      < workflowSource.indexOf("- name: Assemble the signed release APK"),
    "the identity check must sit between prebuild and the build",
  );
});

test("the signer check fails when the application id cannot be read", () => {
  assert.match(
    verifySource,
    /function readPackageName/u,
    "the release check must read the application id rather than assume it",
  );
  assert.doesNotMatch(
    verifySource,
    /if \(packageName && packageName !== pinned\.applicationId\)/u,
    "a missing application id must fail the release, not pass it",
  );
  assert.match(verifySource, /AAPT2_PATH/u);
  assert.match(verifySource, /ANDROID_HOME/u);
});

test("the pinned certificate names the public application id", () => {
  assert.equal(PINNED.applicationId, "com.thedarkskyxd.streamfusion");
  assert.doesNotMatch(PINNED.applicationId, /\.dev$/u);
});

test("aapt2 is available for the release check on the runner", () => {
  // The check is fatal when aapt2 is missing, so the workflow must not depend
  // on it appearing by accident.
  assert.match(
    workflowSource,
    /ANDROID_HOME/u,
    "the signer check needs aapt2 from the Android SDK",
  );
  assert.ok(existsSync("apps/mobile/scripts/verify-release.mjs"));
});
