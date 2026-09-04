import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { load as loadYaml } from "js-yaml";

function loadWorkflow(filename) {
  return loadYaml(readFileSync(`.github/workflows/${filename}`, "utf8"));
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

  const packageServiceReady = source.indexOf("service check package");
  const developmentApkInstall = source.indexOf(
    "adb install --no-streaming apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk",
  );
  assert.ok(packageServiceReady >= 0);
  assert.ok(developmentApkInstall > packageServiceReady);
  assert.match(source, /timeout 300 sh -c .*service check package/);
  assert.match(source, /timeout 300 sh -c .*cmd package list packages/);
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
