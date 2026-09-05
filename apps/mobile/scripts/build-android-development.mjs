import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acquireWindowsDrive,
  createMappedAndroidEnvironment,
  runWithDriveLease,
} from "./run-android.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const mobileRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(mobileRoot, "../..");

export function runBuildCommand(
  command,
  args,
  cwd,
  environment = process.env,
  signals = process,
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: "inherit",
    });
    const forwardSignal = (signal) => {
      try {
        child.kill(signal);
      } catch {
        return;
      }
    };
    const removeSignalHandlers = () => {
      signals.off("SIGINT", forwardSignal);
      signals.off("SIGTERM", forwardSignal);
    };

    signals.on("SIGINT", forwardSignal);
    signals.on("SIGTERM", forwardSignal);
    child.once("error", (error) => {
      removeSignalHandlers();
      reject(error);
    });
    child.once("exit", (code) => {
      removeSignalHandlers();
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code ?? 1}`));
    });
  });
}

async function buildAndroid(root, expoCli, environment = process.env) {
  const gradleRoot = path.join(root, "android");
  const gradleExecutable = path.join(
    gradleRoot,
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  );

  await runBuildCommand(
    process.execPath,
    [expoCli, "prebuild", "--platform", "android", "--no-install"],
    root,
    environment,
  );

  if (!existsSync(gradleExecutable)) {
    throw new Error(`Expo prebuild did not create ${gradleExecutable}`);
  }

  const gradleCommand =
    process.platform === "win32"
      ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
      : gradleExecutable;
  const gradleArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", ".\\gradlew.bat app:assembleDebug"]
      : ["app:assembleDebug"];

  await runBuildCommand(
    gradleCommand,
    gradleArguments,
    gradleRoot,
    environment,
  );
}

async function main() {
  if (process.platform === "win32") {
    const lease = acquireWindowsDrive(repositoryRoot);
    const mappedRepositoryRoot = `${lease.drive}:\\`;
    const mappedMobileRoot = path.win32.join(
      mappedRepositoryRoot,
      "apps",
      "mobile",
    );
    const mappedExpoCli = path.win32.join(
      mappedRepositoryRoot,
      "node_modules",
      "expo",
      "bin",
      "cli",
    );
    await runWithDriveLease(lease, () =>
      buildAndroid(
        mappedMobileRoot,
        mappedExpoCli,
        createMappedAndroidEnvironment(lease),
      ),
    );
  } else {
    await buildAndroid(
      mobileRoot,
      fileURLToPath(import.meta.resolve("expo/bin/cli")),
    );
  }

  console.log(
    path.join(
      mobileRoot,
      "android",
      "app",
      "build",
      "outputs",
      "apk",
      "debug",
      "app-debug.apk",
    ),
  );
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
