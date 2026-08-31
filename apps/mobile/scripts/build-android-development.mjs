import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const expoCli = fileURLToPath(import.meta.resolve("expo/bin/cli"));
const gradleRoot = path.join(mobileRoot, "android");
const gradleExecutable = path.join(
  gradleRoot,
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 1}`));
    });
  });
}

await run(
  process.execPath,
  [expoCli, "prebuild", "--platform", "android", "--no-install"],
  mobileRoot,
);

if (!existsSync(gradleExecutable)) {
  throw new Error(`Expo prebuild did not create ${gradleExecutable}`);
}

await run(gradleExecutable, ["app:assembleDebug"], gradleRoot);

console.log(
  path.join(
    gradleRoot,
    "app",
    "build",
    "outputs",
    "apk",
    "debug",
    "app-debug.apk",
  ),
);
