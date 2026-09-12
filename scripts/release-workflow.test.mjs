import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { load as loadYaml } from "js-yaml";

const VERIFY_SHARDS = [
  { id: "verify-deps", name: "Verify deps" },
  { id: "verify-core", name: "Verify core" },
  { id: "verify-mobile", name: "Verify mobile" },
  { id: "verify-desktop", name: "Verify desktop" },
];
const VERIFY_SHARD_IDS = VERIFY_SHARDS.map((shard) => shard.id);

function loadWorkflow(filename) {
  return loadYaml(readFileSync(`.github/workflows/${filename}`, "utf8"));
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
  assert.doesNotMatch(
    source,
    /android-emulator-runner|\/dev\/kvm|api-level:\s*30/,
  );
  assert.equal(
    existsSync(".github/scripts/verify-android-api30-install.sh"),
    false,
  );
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
