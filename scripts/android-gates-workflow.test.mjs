import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { load as loadYaml } from "js-yaml";

const HOSTED_EMU_FORBIDDEN =
  /android-emulator-runner|\/dev\/kvm|Enable KVM|android-smoke-journey\.sh/;
const JOB_NAME_USES_ENV = /\$\{\{\s*env\./;

async function workflow(name) {
  const source = await readFile(`.github/workflows/${name}`, "utf8");
  return { source, value: loadYaml(source) };
}

async function workflowFiles() {
  return (await readdir(".github/workflows")).filter((name) =>
    name.endsWith(".yml") || name.endsWith(".yaml"),
  );
}

test("workflows invoke every Android gate without a release promotion", async () => {
  const [build, candidate, publicRelease, release] = await Promise.all([
    workflow("build.yml"),
    workflow("android-candidate.yml"),
    workflow("android-public-release.yml"),
    workflow("release.yml"),
  ]);

  assert.match(build.source, /--gate change/);
  assert.match(build.source, /ANDROID_GATE_FRAGMENT: "1"/);
  assert.doesNotMatch(build.source, /--gate main/);
  assert.match(candidate.source, /--gate candidate/);
  assert.match(publicRelease.source, /--gate public-release/);
  assert.doesNotMatch(release.source, /verify:android-gates|android-public-release/i);
  for (const source of [build.source, candidate.source, publicRelease.source]) {
    assert.doesNotMatch(source, /firebase\s+test\s+lab|test-lab/i);
    assert.doesNotMatch(source, HOSTED_EMU_FORBIDDEN);
  }
});

test("GitHub Actions never hosts KVM, emulator-runner, or API smoke jobs", async () => {
  for (const name of await workflowFiles()) {
    const { source, value } = await workflow(name);
    assert.doesNotMatch(source, HOSTED_EMU_FORBIDDEN, name);
    assert.doesNotMatch(source, /name:\s*.*\$\{\{\s*env\./, name);
    assert.equal(value.jobs["main-api30"], undefined, name);
    assert.equal(value.jobs["main-current"], undefined, name);
    assert.equal(value.jobs["main-gate"], undefined, name);
    for (const [id, job] of Object.entries(value.jobs ?? {})) {
      assert.doesNotMatch(
        String(job.name ?? ""),
        JOB_NAME_USES_ENV,
        `${name}:${id}`,
      );
      for (const step of job.steps ?? []) {
        assert.ok(
          typeof step.uses !== "string" ||
            !step.uses.includes("android-emulator-runner"),
          `${name}:${id}`,
        );
      }
    }
  }
});

test("the smoke journey verifies test IDs and screenshots instead of a process ID", async () => {
  const source = await readFile(".github/scripts/android-smoke-journey.sh", "utf8");
  for (const testId of [
    "app-shell-ready",
    "nav-search",
    "nav-following",
    "nav-watch",
    "nav-activity",
    "nav-more",
    "screen-search-root",
    "screen-following-root",
    "screen-watch-root",
    "screen-activity-root",
    "screen-more-root",
  ]) {
    assert.match(source, new RegExp(testId));
  }
  assert.match(source, /uiautomator dump/);
  assert.match(source, /screencap -p/);
  assert.doesNotMatch(source, /\bpidof\b/);
});
