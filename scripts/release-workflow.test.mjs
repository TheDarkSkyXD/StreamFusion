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

function loadWorkflow(filename) {
  return loadYaml(readFileSync(`.github/workflows/${filename}`, "utf8"));
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

function writeAdbStub(directory) {
  const adbPath = path.join(directory, "adb");

  writeFileSync(
    adbPath,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$STUB_ADB_LOG"
case "$*" in
  "devices -l") printf 'List of devices attached\\nemulator-5554 device\\n' ;;
  "shell getprop ro.build.version.sdk") printf '30\\n' ;;
  "shell getprop sys.boot_completed"|"shell getprop dev.bootcomplete") printf '1\\n' ;;
  "shell service check package") printf 'Service package: found\\n' ;;
  "shell cmd package list packages") printf 'package:android\\n' ;;
  "shell service list") printf '0 package: [android.content.pm.IPackageManager]\\n' ;;
  install*)
    if [ "\${STUB_ADB_INSTALL_FAILURE:-0}" = "1" ]; then
      printf "cmd: Can't find service: package\\n" >&2
      exit 20
    fi
    ;;
  "shell monkey"*|"shell pidof "*) printf '1234\\n' ;;
  *) printf 'Unexpected adb command: %s\\n' "$*" >&2; exit 64 ;;
esac
`,
  );
  chmodSync(adbPath, 0o755);
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

  const androidInstallScript = readFileSync(
    ".github/scripts/verify-android-api30-install.sh",
    "utf8",
  );
  const packageServiceReady = androidInstallScript.indexOf(
    "service check package",
  );
  const developmentApkInstall = androidInstallScript.indexOf(
    "adb install --no-streaming apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk",
  );
  assert.ok(packageServiceReady >= 0);
  assert.ok(developmentApkInstall > packageServiceReady);
  assert.match(
    androidInstallScript,
    /timeout 300 sh -c .*service check package/,
  );
  assert.match(
    androidInstallScript,
    /timeout 300 sh -c .*cmd package list packages/,
  );
});

test("the API 30 job enables and verifies KVM before accelerated boot", () => {
  const source = readFileSync(".github/workflows/build.yml", "utf8");
  const workflow = loadWorkflow("build.yml");
  const androidJob = workflow.jobs["android-development"];
  const kvmStep = androidJob.steps.find(
    (step) => step.name === "Enable KVM access for the ephemeral Android job",
  );
  const emulatorStep = androidJob.steps.find(
    (step) => step.name === "Install and launch on API 30",
  );

  assert.ok(kvmStep);
  assert.ok(emulatorStep);
  assert.ok(
    workflow.jobs.verify.steps.some(
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
  assert.deepEqual(parsePinnedActionScript(emulatorStep.with.script), [
    "bash .github/scripts/verify-android-api30-install.sh",
  ]);
  assert.equal(
    existsSync(".github/scripts/verify-android-api30-install.sh"),
    true,
  );
});

test("the pre-launch acceleration check uses the action SDK root", () => {
  const workflow = loadWorkflow("build.yml");
  const emulatorStep = workflow.jobs["android-development"].steps.find(
    (step) => step.name === "Install and launch on API 30",
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

test("the API 30 install script survives the pinned action parser and fails terminally", () => {
  const workflow = loadWorkflow("build.yml");
  const emulatorStep = workflow.jobs["android-development"].steps.find(
    (step) => step.name === "Install and launch on API 30",
  );
  const actionScripts = parsePinnedActionScript(emulatorStep.with.script);
  const directory = mkdtempSync(path.join(process.cwd(), ".workflow API30's-"));
  const stubDirectory = path.join(directory, "bin");
  const adbLogPath = path.join(directory, "adb.log");
  const bashStubDirectory = relativeShellPath(stubDirectory);
  const bashAdbLogPath = relativeShellPath(adbLogPath);

  mkdirSync(stubDirectory);
  writeAdbStub(stubDirectory);
  try {
    assert.equal(
      shellQuote("path with space's quote"),
      "'path with space'\"'\"'s quote'",
    );
    const successfulInstall = runPinnedActionScripts(
      actionScripts,
      bashStubDirectory,
      { STUB_ADB_LOG: bashAdbLogPath },
    );

    assert.equal(successfulInstall.status, 0, successfulInstall.stderr);
    assert.match(readFileSync(adbLogPath, "utf8"), /install --no-streaming/);
    assert.match(readFileSync(adbLogPath, "utf8"), /shell monkey/);

    writeFileSync(adbLogPath, "");
    const failedInstall = runPinnedActionScripts(
      actionScripts,
      bashStubDirectory,
      {
        STUB_ADB_INSTALL_FAILURE: "1",
        STUB_ADB_LOG: bashAdbLogPath,
      },
    );

    assert.equal(failedInstall.status, 1);
    assert.match(failedInstall.stdout, /Android package-service diagnostics/);
    assert.match(
      failedInstall.stdout,
      /package: \[android.content.pm.IPackageManager\]/,
    );
    assert.match(failedInstall.stderr, /Can't find service: package/);
    assert.equal(
      readFileSync(adbLogPath, "utf8").match(/install --no-streaming/g)?.length,
      1,
    );
    assert.doesNotMatch(readFileSync(adbLogPath, "utf8"), /shell monkey/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
