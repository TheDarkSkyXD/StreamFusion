import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { load as loadYaml } from "js-yaml";

const VERIFY_SHARDS = [
  { id: "verify-deps", name: "Verify deps" },
  { id: "verify-core", name: "Verify core" },
  { id: "verify-mobile", name: "Verify mobile" },
  { id: "verify-desktop", name: "Verify desktop" },
];
const VERIFY_SHARD_IDS = VERIFY_SHARDS.map((shard) => shard.id);
const HOSTED_EMU_FORBIDDEN =
  /android-emulator-runner|\/dev\/kvm|Enable KVM|android-smoke-journey\.sh/;
const JOB_NAME_USES_ENV = /\$\{\{\s*env\./;

function loadWorkflow(filename) {
  return loadYaml(readFileSync(`.github/workflows/${filename}`, "utf8"));
}

function workflowFiles() {
  return readdirSync(".github/workflows").filter(
    (name) => name.endsWith(".yml") || name.endsWith(".yaml"),
  );
}

function stepNamed(job, name) {
  return job.steps.find((step) => step.name === name);
}

function jobRuns(job, command) {
  return job.steps.some((step) => step.run === command);
}

test("the build workflow is CI-only and cannot publish a GitHub release", () => {
  const source = readFileSync(".github/workflows/build.yml", "utf8");
  const workflow = loadWorkflow("build.yml");

  assert.deepEqual(workflow.on.push, { branches: ["main"] });
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.jobs.release, undefined);
  assert.equal(workflow.jobs.verify, undefined);
  assert.doesNotMatch(source, /GITHUB_TOKEN|action-gh-release/);
  assert.match(source, /macos-15-intel/);
  assert.match(source, /npm install --global npm@11\.19\.0/);
  assert.match(source, /npm run audit:signatures/);
  assert.match(source, /deploy:dry-run/);
  assert.match(source, /rebuild-deps:\$\{\{ matrix\.arch \}\}/);
  assert.match(source, /package:\$\{\{ matrix\.arch \}\}/);
  assert.doesNotMatch(source, /npm (?:exec|run).* -- --(?:arch|dry-run)/);
  assert.doesNotMatch(
    source,
    /npm --prefix apps\/desktop (?:ci|audit|rebuild)/,
  );
  assert.doesNotMatch(source, /pnpm\/action-setup|\bpnpm\b/);
  assert.doesNotMatch(source, HOSTED_EMU_FORBIDDEN);
  assert.doesNotMatch(source, /api-level:\s*30/);
  assert.equal(workflow.jobs["main-api30"], undefined);
  assert.equal(workflow.jobs["main-current"], undefined);
  assert.equal(workflow.jobs["main-gate"], undefined);
  assert.equal(
    existsSync(".github/scripts/verify-android-api30-install.sh"),
    false,
  );
});

test("GitHub Actions workflows never enable KVM or name jobs with env context", () => {
  for (const name of workflowFiles()) {
    const source = readFileSync(`.github/workflows/${name}`, "utf8");
    const workflow = loadWorkflow(name);

    assert.doesNotMatch(source, HOSTED_EMU_FORBIDDEN, name);
    assert.doesNotMatch(source, /name:\s*.*\$\{\{\s*env\./, name);
    for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
      assert.doesNotMatch(
        String(job.name ?? ""),
        JOB_NAME_USES_ENV,
        `${name}:${id}`,
      );
      assert.ok(
        (job.steps ?? []).every(
          (step) =>
            typeof step.uses !== "string" ||
            !step.uses.includes("android-emulator-runner"),
        ),
        `${name}:${id}`,
      );
    }
  }
});

test("verify shards and CI success form a fail-closed gate", () => {
  const workflow = loadWorkflow("build.yml");
  const aggregator = workflow.jobs["ci-success"];

  assert.equal(aggregator.name, "CI success");
  assert.equal(aggregator.if, "always()");
  assert.deepEqual(aggregator.needs, VERIFY_SHARD_IDS);

  for (const shard of VERIFY_SHARDS) {
    assert.equal(workflow.jobs[shard.id].name, shard.name);
    assert.equal(workflow.jobs[shard.id].needs, undefined);
  }

  const requireStep = stepNamed(aggregator, "Require every verify shard");
  assert.deepEqual(requireStep.env, {
    DEPS: "${{ needs.verify-deps.result }}",
    CORE: "${{ needs.verify-core.result }}",
    MOBILE: "${{ needs.verify-mobile.result }}",
    DESKTOP: "${{ needs.verify-desktop.result }}",
  });
  assert.match(requireStep.run, /test "\$DEPS" = success/);
  assert.match(requireStep.run, /test "\$CORE" = success/);
  assert.match(requireStep.run, /test "\$MOBILE" = success/);
  assert.match(requireStep.run, /test "\$DESKTOP" = success/);
});

test("every verify shard installs without lifecycle scripts then rebuilds approved dependencies", () => {
  const workflow = loadWorkflow("build.yml");

  for (const { id } of VERIFY_SHARDS) {
    const job = workflow.jobs[id];
    assert.ok(jobRuns(job, "npm ci --ignore-scripts"), id);
    assert.ok(jobRuns(job, "npm run rebuild:dependencies"), id);
  }
});

test("dependency review and audit gates stay on the deps shard", () => {
  const workflow = loadWorkflow("build.yml");
  const deps = workflow.jobs["verify-deps"];
  const review = stepNamed(deps, "Review dependency changes");

  assert.equal(review.if, "github.event_name == 'pull_request'");
  assert.match(
    review.uses,
    /actions\/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294/,
  );
  assert.equal(review.with["fail-on-severity"], "high");
  assert.ok(
    jobRuns(deps, "node --test scripts/release-workflow.test.mjs"),
  );
  assert.ok(jobRuns(deps, "npm run lint:dependencies"));
  assert.ok(jobRuns(deps, "npm run lint:lockfile"));
  assert.ok(jobRuns(deps, "npm run audit:signatures"));
  assert.ok(jobRuns(deps, "npm run audit:dependencies"));

  for (const id of ["verify-core", "verify-mobile", "verify-desktop"]) {
    assert.equal(
      stepNamed(workflow.jobs[id], "Review dependency changes"),
      undefined,
    );
    assert.ok(!jobRuns(workflow.jobs[id], "npm run audit:signatures"));
    assert.ok(!jobRuns(workflow.jobs[id], "npm run audit:dependencies"));
  }
});

test("verify shards keep the workspace commands from the former Verify workspace job", () => {
  const workflow = loadWorkflow("build.yml");
  const core = workflow.jobs["verify-core"];
  const mobile = workflow.jobs["verify-mobile"];
  const desktop = workflow.jobs["verify-desktop"];

  assert.ok(jobRuns(core, "npm run --workspace @streamfusion/core lint"));
  assert.ok(jobRuns(core, "npm run lint:core-imports"));
  assert.ok(jobRuns(core, "npm run --workspace @streamfusion/core typecheck"));
  assert.ok(jobRuns(core, "npm run --workspace @streamfusion/core test"));
  assert.ok(
    jobRuns(core, "npm run --workspace @streamfusion/integration-relay lint"),
  );
  assert.ok(
    jobRuns(
      core,
      "npm run --workspace @streamfusion/integration-relay typecheck",
    ),
  );
  assert.ok(
    jobRuns(core, "npm run --workspace @streamfusion/integration-relay test"),
  );
  assert.ok(
    jobRuns(
      core,
      "npm run --workspace @streamfusion/integration-relay deploy:dry-run",
    ),
  );

  assert.ok(jobRuns(mobile, "npm run --workspace @streamfusion/mobile lint"));
  assert.ok(
    jobRuns(mobile, "npm run --workspace @streamfusion/mobile typecheck"),
  );
  assert.ok(jobRuns(mobile, "npm run --workspace @streamfusion/mobile test"));
  assert.ok(
    jobRuns(mobile, "npm run --workspace @streamfusion/mobile bundle:android"),
  );

  assert.ok(jobRuns(desktop, "npm run test:evidence"));
  assert.ok(jobRuns(desktop, "npm run verify:evidence"));
  assert.ok(jobRuns(desktop, "npm --prefix apps/desktop run lint"));
  assert.ok(jobRuns(desktop, "npm --prefix apps/desktop run typecheck"));
  assert.ok(
    jobRuns(desktop, "npm --prefix apps/desktop run parity:desktop:check"),
  );
  assert.ok(jobRuns(desktop, "npm --prefix apps/desktop test"));
  assert.ok(
    jobRuns(desktop, "npm run --workspace streamfusion-worker typecheck"),
  );
  assert.ok(jobRuns(desktop, "npm run --workspace streamfusion-worker test"));
  assert.ok(
    jobRuns(desktop, "npm run --workspace streamfusion-worker deploy:dry-run"),
  );
});

test("Android Change Gate runs on the desktop shard without a hosted emulator", () => {
  const workflow = loadWorkflow("build.yml");
  const desktop = workflow.jobs["verify-desktop"];
  const change = stepNamed(desktop, "Android Change Gate");

  assert.equal(change.env.ANDROID_GATE_FRAGMENT, "1");
  assert.match(change.run, /--gate change/);
  assert.equal(
    stepNamed(desktop, "Enable KVM access for the ephemeral Android job"),
    undefined,
  );
});

test("Android CI builds the development APK without KVM or an emulator", () => {
  const workflow = loadWorkflow("build.yml");
  const android = workflow.jobs["android-development"];

  assert.equal(android.name, "Android development APK");
  assert.equal(android.needs, "ci-success");
  assert.ok(jobRuns(android, "npm ci --ignore-scripts"));
  assert.ok(jobRuns(android, "npm run build:mobile:development"));
  assert.equal(
    stepNamed(android, "Enable KVM access for the ephemeral Android job"),
    undefined,
  );
  assert.equal(stepNamed(android, "Install and launch on API 30"), undefined);
  assert.ok(
    android.steps.every(
      (step) =>
        typeof step.uses !== "string" ||
        !step.uses.includes("android-emulator-runner"),
    ),
  );
});

test("desktop package jobs wait for CI success", () => {
  const workflow = loadWorkflow("build.yml");

  assert.equal(workflow.jobs.build.needs, "ci-success");
});

test("one release workflow handles tagged and manual releases with fail-closed gates", () => {
  const source = readFileSync(".github/workflows/release.yml", "utf8");
  const workflow = loadWorkflow("release.yml");

  assert.deepEqual(workflow.on.push.tags, ["v*"]);
  assert.equal(workflow.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(existsSync(".github/workflows/pre-release.yml"), false);
  assert.match(source, /inputs\.tag \|\| github\.ref/);
  assert.match(source, /scripts\/release-policy\.mjs/);
  assert.match(source, /npm run audit:signatures/);
  assert.match(source, /npm run audit:dependencies/);
  assert.match(source, /npm install --global npm@11\.19\.0/);
  assert.match(source, /deploy:dry-run/);
  assert.match(source, /rebuild-deps:\$\{\{ matrix\.arch \}\}/);
  assert.match(
    source,
    /package:\$\{\{ matrix\.platform \}\}:\$\{\{ matrix\.arch \}\}:signed/,
  );
  assert.doesNotMatch(source, /npm (?:exec|run).* -- --(?:arch|dry-run)/);
  assert.doesNotMatch(
    source,
    /npm --prefix apps\/desktop (?:ci|audit|rebuild)/,
  );
  assert.doesNotMatch(source, /pnpm\/action-setup|\bpnpm\b/);
  assert.match(source, /macos-15-intel/);
  assert.match(source, /macos-15/);
  assert.match(source, /\.exe\.blockmap/);
  assert.match(source, /if-no-files-found: error/);
  assert.match(source, /gh release create/);
  assert.match(source, /--verify-tag/);
  assert.match(source, /--generate-notes/);
  assert.doesNotMatch(source, /action-gh-release/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /codesign --verify --deep --strict/);
  assert.match(source, /spctl --assess --type exec/);
  assert.match(source, /xcrun stapler validate/);
  assert.match(source, /secrets\.WIN_CSC_LINK/);
  assert.match(source, /secrets\.MAC_CSC_LINK/);
  assert.doesNotMatch(source, /builder-debug|apps\/desktop\/release\/\*\.yml/);
});

test("the android tag namespace cannot trigger the desktop release workflow", async () => {
  const { validateMobileReleaseTag } = await import("./release-policy.mjs");
  const [tagPattern] = loadWorkflow("release.yml").on.push.tags;
  const matches = (tag) => new RegExp(`^${tagPattern.replaceAll("*", "[\\s\\S]*")}$`, "u").test(tag);

  assert.equal(matches("v2.0.0"), true, "desktop tags still trigger a release");
  assert.equal(
    matches("android-v0.1.0-alpha"),
    false,
    "an android tag must not start a desktop release",
  );
  assert.throws(
    () => validateMobileReleaseTag({ tag: "android-v9.9.9", version: "0.1.0-alpha" }),
    /must exactly match mobile version/
  );
});

test("the android release workflow owns the android tag namespace and nothing else", () => {
  const android = loadWorkflow("android-release.yml");
  const desktop = loadWorkflow("release.yml");

  assert.deepEqual(android.on.push.tags, ["android-v*"]);
  assert.deepEqual(desktop.on.push.tags, ["v*"]);
  assert.equal(android.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(android.concurrency["cancel-in-progress"], false);
  assert.match(android.concurrency.group, /^android-release-/u);
  assert.equal(android.name, "Android release");
  assert.notEqual(android.name, desktop.name);

  const source = readFileSync(".github/workflows/android-release.yml", "utf8");
  assert.match(source, /case "\$RELEASE_TAG" in\n\s*android-v\*\)/u);
  assert.match(source, /scripts\/release-policy\.mjs/u);
  assert.match(source, /git show-ref --verify --quiet/u);
  assert.doesNotMatch(source, /apps\/desktop/u);
});

test("the android release never publishes an unsigned or debug-signed APK", () => {
  const source = readFileSync(".github/workflows/android-release.yml", "utf8");

  // The desktop workflow degrades to unsigned packaging and still publishes.
  // Android has one legal mode: an APK without the production signature either
  // will not install or silently forks the app identity, so there is no
  // "unsigned" branch to copy here.
  assert.doesNotMatch(source, /unsigned/iu);
  assert.doesNotMatch(source, /assembleDebug/u);
  assert.doesNotMatch(source, /signingConfig/u);
  assert.doesNotMatch(source, /CSC_LINK|WIN_CSC|MAC_CSC/u);
  // The production identity is selected by the channel variable, not by an EAS
  // build profile, because the APK is now assembled on the runner.
  assert.match(source, /STREAMFUSION_RELEASE_CHANNEL: production/u);
  assert.match(source, /app:assembleRelease/u);
  assert.doesNotMatch(source, /assembleDebug|eas build|eas-cli/u);
});

test("the android release fails closed on the signing certificate", () => {
  const source = readFileSync(".github/workflows/android-release.yml", "utf8");
  const { verify, signing, build } = loadWorkflow("android-release.yml").jobs;

  assert.ok(signing, "a signing prerequisite job must exist");
  assert.deepEqual(signing.needs, "verify");
  assert.deepEqual(build.needs, ["verify", "signing"]);

  const runs = Object.values({ verify, signing, build })
    .flatMap((job) => job.steps.map((step) => step.run ?? ""))
    .join("\n");
  assert.doesNotMatch(runs, /\|\|\s*true/u);
  assert.doesNotMatch(runs, /continue-on-error/u);
  assert.doesNotMatch(runs, /--no-verify/u);
  assert.doesNotMatch(source, /always\(\)/u);

  // The bare form only checks the pin exists; the APK form is what proves the
  // artifact was signed by it. Both must appear.
  assert.match(
    stepNamed(signing, "Require a pinned production signing certificate").run,
    /verify:release(?! --)/u,
  );
  assert.match(
    stepNamed(build, "Verify the APK against the pinned signer").run,
    /verify:release -- "android-release-set\/\$ASSET_NAME"/u,
  );
});

test("the android release publishes a draft before it publishes", () => {
  const source = readFileSync(".github/workflows/android-release.yml", "utf8");
  const { release } = loadWorkflow("android-release.yml").jobs;

  const create = stepNamed(release, "Create the draft release");
  const publish = stepNamed(release, "Publish the immutable release");
  assert.match(create.run, /--verify-tag/u);
  assert.match(create.run, /--draft(?!=)/u);
  assert.match(create.run, /--notes-file release-assets\/release-notes\.md/u);
  assert.doesNotMatch(create.run, /--generate-notes/u);
  assert.match(publish.run, /--draft=false/u);
  assert.match(publish.run, /gh release verify/u);
  assert.doesNotMatch(source, /gh release delete/u);
  assert.doesNotMatch(source, /--clobber/u);
});

test("only the android publish job may write to the repository", () => {
  const workflow = loadWorkflow("android-release.yml");

  assert.equal(workflow.permissions.contents, "read");
  const writers = Object.entries(workflow.jobs)
    .filter(([, job]) => job.permissions?.contents === "write")
    .map(([id]) => id);
  assert.deepEqual(writers, ["release"]);
  assert.doesNotMatch(
    JSON.stringify(workflow.jobs),
    /write-all|"actions":\s*"write"|"pull-requests":\s*"write"/u,
  );

  // Mobile approval must not queue behind desktop approval.
  assert.equal(workflow.jobs.build.environment, "android-release");
  assert.equal(workflow.jobs.release.environment, "android-release");
  assert.notEqual(workflow.jobs.release.environment, "production-release");
});

test("the android release refuses an EAS build from another commit", () => {
  const { build } = loadWorkflow("android-release.yml").jobs;

  // The build now runs Gradle on the runner, so there is no EAS metadata to
  // reconcile. It must never silently fall back to EAS, which would need an
  // Expo token the repository does not have.
  const buildSteps = build.steps.map((step) => step.name);
  assert.ok(buildSteps.includes("Assemble the signed release APK"));
  assert.ok(buildSteps.includes("Materialize the production keystore"));
  assert.doesNotMatch(
    readFileSync(".github/workflows/android-release.yml", "utf8"),
    /eas-cli|EXPO_TOKEN/u,
  );
  const assemble = stepNamed(build, "Assemble the signed release APK");
  assert.match(assemble.run, /app:assembleRelease/u);
  assert.match(assemble.run, /app-release\.apk/u);
  assert.match(assemble.run, /set -euo pipefail/u);
  const materialize = stepNamed(build, "Materialize the production keystore");
  for (const secret of [
    "STREAMFUSION_MOBILE_KEYSTORE_BASE64",
    "STREAMFUSION_MOBILE_KEYSTORE_PASSWORD",
    "STREAMFUSION_MOBILE_KEY_ALIAS",
    "STREAMFUSION_MOBILE_KEY_PASSWORD",
  ]) {
    assert.ok(
      Object.values(materialize.env ?? {}).includes(`\${{ secrets.${secret} }}`),
      `${secret} must be read or the build signs with the debug key`,
    );
  }
  for (const exported of [
    "STREAMFUSION_UPLOAD_STORE_FILE",
    "STREAMFUSION_UPLOAD_STORE_PASSWORD",
    "STREAMFUSION_UPLOAD_KEY_ALIAS",
    "STREAMFUSION_UPLOAD_KEY_PASSWORD",
  ]) {
    assert.match(
      materialize.run,
      new RegExp(exported, "u"),
      `${exported} must reach Gradle or the release is signed with the debug key`,
    );
  }
  assert.equal(assemble.env.ASSET_NAME, "${{ needs.verify.outputs.asset_name }}");
});

test("the android release attaches the whole Release Set and nothing partial", () => {
  const source = readFileSync(".github/workflows/android-release.yml", "utf8");
  const { build } = loadWorkflow("android-release.yml").jobs;

  const upload = stepNamed(build, "Upload the Android Release Set");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.ok(upload.with["retention-days"], "the promote step must survive approval latency");
  assert.match(source, /assemble-android-release-set\.mjs/u);
  for (const asset of ["android-update.json", "SHA256SUMS", "build-info.json", "release-notes.md"]) {
    assert.ok(
      existsSync(`scripts/assemble-android-release-set.mjs`) &&
        readFileSync("scripts/assemble-android-release-set.mjs", "utf8").includes(asset),
      `the Release Set must include ${asset}`,
    );
  }
});

test("the android release does not duplicate the Android Release Gate", () => {
  const source = readFileSync(".github/workflows/android-release.yml", "utf8");

  assert.doesNotMatch(source, /verify:android-gates/u);
  assert.doesNotMatch(source, /android-public-release/u);
  assert.equal(existsSync(".github/workflows/pre-release.yml"), false);
  assert.equal(existsSync(".github/workflows/android-release.yml"), true);
  assert.doesNotMatch(source, HOSTED_EMU_FORBIDDEN);
  assert.doesNotMatch(source, /firebase\s+test\s+lab|test-lab/iu);
});

test("electron-builder emits deterministic installer names and macOS updater archives", () => {
  const desktopPackage = JSON.parse(
    readFileSync("apps/desktop/package.json", "utf8"),
  );

  assert.equal(
    desktopPackage.build.win.artifactName,
    "${productName}-${version}-Setup.${ext}",
  );
  assert.equal(
    desktopPackage.build.mac.artifactName,
    "${productName}-${version}-${arch}.${ext}",
  );
  assert.deepEqual(desktopPackage.build.mac.target, ["dmg", "zip"]);
  assert.equal(desktopPackage.build.forceCodeSigning, undefined);
  assert.match(
    desktopPackage.scripts["package:windows:x64:signed"],
    /--win --x64 .*forceCodeSigning=true/,
  );
  assert.match(
    desktopPackage.scripts["package:macos:x64:signed"],
    /--mac --x64 .*forceCodeSigning=true .*mac\.notarize=true/,
  );
  assert.match(
    desktopPackage.scripts["package:macos:arm64:signed"],
    /--mac --arm64 .*forceCodeSigning=true .*mac\.notarize=true/,
  );
});
