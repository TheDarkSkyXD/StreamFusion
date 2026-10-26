import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mobileRoot = fileURLToPath(new URL("../", import.meta.url));
const stagingRoot = path.join(mobileRoot, ".cxx");
const temporaryRoot = path.join(mobileRoot, ".tmp");
mkdirSync(temporaryRoot, { recursive: true });
const fixture = mkdtempSync(path.join(temporaryRoot, "native-build-lifecycle-"));
const initScript = path.join(fixture, "verify.gradle");

writeFileSync(
  initScript,
  `gradle.projectsEvaluated {
  def root = gradle.rootProject
  if (root.name != "StreamFusion") return
  def stagingRoot = new File(root.projectDir.parentFile, ".cxx").canonicalFile
  def mode = root.findProperty("nativeLifecycleFailure")
  if (mode == "configuration") {
    def marker = new File(stagingRoot, "configuration/marker")
    marker.parentFile.mkdirs()
    marker.text = "configuration failure"
    throw new GradleException("Expected native lifecycle configuration failure")
  }
  root.tasks.register("verifyNativeBuildLifecycle") {
    doLast {
      root.subprojects.each { nativeProject ->
        def android = nativeProject.extensions.findByName("android")
        if (android != null) {
          def directory = android.externalNativeBuild.cmake.buildStagingDirectory.canonicalFile
          assert directory.toPath().startsWith(stagingRoot.toPath()): "Native staging escaped mobile: \${directory}"
          def marker = new File(directory, "lifecycle-marker")
          marker.parentFile.mkdirs()
          marker.text = "native build in progress"
        }
      }
      assert stagingRoot.isDirectory(): "No native staging directories were exercised"
      println "Native staging is inside mobile during the build"
      if (mode == "execution") {
        throw new GradleException("Expected native lifecycle execution failure")
      }
    }
  }
}
`,
);

test.after(() => rmSync(fixture, { recursive: true, force: true }));

for (const mode of ["success", "execution", "configuration"]) {
  test(`native staging stays in mobile and is removed after ${mode}`, () => {
    const arguments_ = [
      "--console=plain",
      "--no-configuration-cache",
      "--init-script",
      path.relative(path.join(mobileRoot, "android"), initScript),
      "verifyNativeBuildLifecycle",
      `-PnativeLifecycleFailure=${mode}`,
    ];
    const result = spawnSync(
      process.platform === "win32" ? "cmd.exe" : "./gradlew",
      process.platform === "win32"
        ? ["/d", "/s", "/c", `.\\gradlew.bat ${arguments_.join(" ")}`]
        : arguments_,
      {
        cwd: path.join(mobileRoot, "android"),
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      },
    );
    assert.ifError(result.error);
    const output = result.stdout + result.stderr;
    if (mode === "success") {
      assert.equal(result.status, 0, output);
    } else {
      assert.notEqual(result.status, 0, output);
      assert.match(
        output,
        new RegExp(`Expected native lifecycle ${mode} failure`, "u"),
      );
    }
    assert.equal(
      existsSync(stagingRoot),
      false,
      `Native staging remained after ${mode}\n${output}`,
    );
  });
}
