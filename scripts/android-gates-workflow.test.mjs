import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { load as loadYaml } from "js-yaml";

const emulatorAction =
  "reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d";

async function workflow(name) {
  const source = await readFile(`.github/workflows/${name}`, "utf8");
  return { source, value: loadYaml(source) };
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
  assert.match(build.source, /--gate main/);
  assert.match(candidate.source, /--gate candidate/);
  assert.match(publicRelease.source, /--gate public-release/);
  assert.doesNotMatch(release.source, /verify:android-gates|android-public-release/i);
  for (const source of [build.source, candidate.source, publicRelease.source]) {
    assert.doesNotMatch(source, /firebase\s+test\s+lab|test-lab/i);
  }
});

test("Main drives API 30 and current API journeys then always evaluates fragments", async () => {
  const { value: build } = await workflow("build.yml");
  const api30 = build.jobs["main-api30"];
  const current = build.jobs["main-current"];
  const finalizer = build.jobs["main-gate"];

  assert.equal(build.env.CURRENT_ANDROID_API, "36");
  assert.equal(current.steps.find((step) => step.uses === emulatorAction).with["api-level"], "${{ env.CURRENT_ANDROID_API }}");
  assert.equal(api30.steps.find((step) => step.uses === emulatorAction).with["api-level"], 30);
  assert.equal(finalizer.if, "${{ always() }}");
  assert.deepEqual(finalizer.needs, ["ci-success", "main-api30", "main-current"]);
  for (const job of [api30, current]) {
    const emulator = job.steps.find((step) => step.uses === emulatorAction);
    assert.ok(emulator);
    assert.match(emulator.with.script, /android-smoke-journey\.sh/);
  }
  assert.match(
    finalizer.steps.find((step) => step.name === "Evaluate Main Gate").run,
    /--gate main .*--read .*--incoming/,
  );
  assert.equal(
    finalizer.steps.find((step) => step.name === "Download Main evidence fragments").with.pattern,
    "android-*-evidence",
  );
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
