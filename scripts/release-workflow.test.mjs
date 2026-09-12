import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
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

function parsePinnedActionScript(rawScript) {
  return rawScript
    .trim()
    .split(/\r\n|\n|\r/)
    .map((value) => value.trim())
    .filter((value) => !value.startsWith("#") && value.length > 0);
}

function relativeShellPath(value) {
  return `./${path.relative(process.cwd(), value).replaceAll("\\", "/")}`;
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function testShell() {
  const gitBashPath = "C:/Program Files/Git/bin/bash.exe";

  return process.platform === "win32" && existsSync(gitBashPath)
    ? gitBashPath
    : "bash";
}

function runPinnedActionScripts(commands, adbStubDirectory, environment) {
  const assignments = Object.entries(environment)
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ");

  let result;
  for (const command of commands) {
    result = spawnSync(
      testShell(),
      [
        "-c",
        `PATH=${shellQuote(adbStubDirectory)}:"$PATH"; export PATH; ${assignments} sh -c ${shellQuote(command)}`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    if (result.status !== 0) {
      return result;
    }
  }

  return result;
}

function writeEmulatorStub(directory) {
  const emulatorPath = path.join(directory, "emulator", "emulator");

  mkdirSync(path.dirname(emulatorPath), { recursive: true });
  writeFileSync(
    emulatorPath,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$STUB_EMULATOR_LOG"
if [ "\${STUB_EMULATOR_FAILURE:-0}" = "1" ]; then
  exit 42
fi
`,
  );
  chmodSync(emulatorPath, 0o755);
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
  assert.equal(
    existsSync(".github/scripts/verify-android-api30-install.sh"),
    false,
  );

  const androidInstallScript = readFileSync(
    ".github/scripts/android-smoke-journey.sh",
    "utf8",
  );
  assert.match(androidInstallScript, /uiautomator dump/);
  assert.match(androidInstallScript, /app-shell-ready/);
  assert.doesNotMatch(androidInstallScript, /\bpidof\b/);
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

test("the API 30 job enables and verifies KVM before accelerated boot", () => {
  const source = readFileSync(".github/workflows/build.yml", "utf8");
  const workflow = loadWorkflow("build.yml");
  const androidJob = workflow.jobs["main-api30"];
  const kvmStep = androidJob.steps.find(
    (step) => step.name === "Enable KVM access for the ephemeral Android job",
  );
  const emulatorStep = androidJob.steps.find(
    (step) => step.name === "Run API 30 Android smoke journey",
  );

  assert.ok(kvmStep);
  assert.ok(emulatorStep);
  assert.ok(
    workflow.jobs["verify-deps"].steps.some(
      (step) =>
        step.name === "Test checked-in workflow contracts" &&
        step.run === "node --test scripts/release-workflow.test.mjs",
    ),
  );
  assert.ok(
    androidJob.steps.indexOf(kvmStep) < androidJob.steps.indexOf(emulatorStep),
  );
  assert.match(kvmStep.run, /KERNEL=="kvm"/);
  assert.match(kvmStep.run, /--name-match=kvm/);
  assert.match(kvmStep.run, /test -c \/dev\/kvm/);
  assert.match(kvmStep.run, /test -r \/dev\/kvm/);
  assert.match(kvmStep.run, /test -w \/dev\/kvm/);
  assert.equal(emulatorStep.with["disable-linux-hw-accel"], false);
  assert.match(
    emulatorStep.with["pre-emulator-launch-script"],
    /"\$ANDROID_HOME\/emulator\/emulator" -accel-check/,
  );
  assert.doesNotMatch(source, /-accel off/);
  assert.match(emulatorStep.with.script, /android-smoke-journey\.sh/);
  assert.equal(
    existsSync(".github/scripts/android-smoke-journey.sh"),
    true,
  );
});

test("the pre-launch acceleration check uses the action SDK root", () => {
  const workflow = loadWorkflow("build.yml");
  const emulatorStep = workflow.jobs["main-api30"].steps.find(
    (step) => step.name === "Run API 30 Android smoke journey",
  );
  const commands = parsePinnedActionScript(
    emulatorStep.with["pre-emulator-launch-script"],
  );
  const directory = mkdtempSync(
    path.join(process.cwd(), ".workflow SDK root's-"),
  );
  const fakePathDirectory = path.join(directory, "path");
  const sdkDirectory = path.join(directory, "SDK with space's quote");
  const emulatorLogPath = path.join(directory, "emulator.log");

  mkdirSync(fakePathDirectory);
  writeFileSync(
    path.join(fakePathDirectory, "emulator"),
    "#!/usr/bin/env bash\nexit 66\n",
  );
  chmodSync(path.join(fakePathDirectory, "emulator"), 0o755);
  writeEmulatorStub(sdkDirectory);
  try {
    assert.deepEqual(commands, [
      '"$ANDROID_HOME/emulator/emulator" -accel-check',
    ]);
    const successfulCheck = runPinnedActionScripts(
      commands,
      relativeShellPath(fakePathDirectory),
      {
        ANDROID_HOME: relativeShellPath(sdkDirectory),
        STUB_EMULATOR_LOG: relativeShellPath(emulatorLogPath),
      },
    );

    assert.equal(successfulCheck.status, 0, successfulCheck.stderr);
    assert.equal(readFileSync(emulatorLogPath, "utf8"), "-accel-check\n");

    const failedCheck = runPinnedActionScripts(
      commands,
      relativeShellPath(fakePathDirectory),
      {
        ANDROID_HOME: relativeShellPath(sdkDirectory),
        STUB_EMULATOR_FAILURE: "1",
        STUB_EMULATOR_LOG: relativeShellPath(emulatorLogPath),
      },
    );

    assert.equal(failedCheck.status, 42);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the Main gate reads both journey fragments after the jobs complete", () => {
  const workflow = loadWorkflow("build.yml");
  const finalizer = workflow.jobs["main-gate"];

  assert.equal(finalizer.if, "${{ always() }}");
  assert.deepEqual(finalizer.needs, [
    "ci-success",
    "main-api30",
    "main-current",
  ]);
  assert.match(
    finalizer.steps.find((step) => step.name === "Evaluate Main Gate").run,
    /--gate main .*--read/,
  );
  assert.ok(
    finalizer.steps.some(
      (step) => step.name === "Download Main evidence fragments",
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
