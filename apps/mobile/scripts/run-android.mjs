import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJavaAvailable } from "./build-android-development.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const mobileRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(mobileRoot, "../..");

function relativeTaskPath(repositoryDirectory, targetPath) {
  const resolvedRepositoryDirectory = realpathSync(repositoryDirectory);
  const resolvedTargetPath = realpathSync(targetPath);
  const relativePath = path.relative(
    resolvedRepositoryDirectory,
    resolvedTargetPath,
  );
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      `Resolved path must stay inside the task worktree: ${resolvedTargetPath}`,
    );
  }
  return relativePath;
}

export function resolveMobileReactNativeCli(
  mobileDirectory = mobileRoot,
  repositoryDirectory = repositoryRoot,
) {
  const mobilePackage = path.join(mobileDirectory, "package.json");
  const reactNativeCli = createRequire(mobilePackage).resolve(
    "@react-native-community/cli/build/bin.js",
  );
  relativeTaskPath(repositoryDirectory, reactNativeCli);
  return reactNativeCli;
}

function run(command, args, cwd, environment = process.env) {
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
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
    };

    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);
    child.once("error", (error) => {
      removeSignalHandlers();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      removeSignalHandlers();
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}`,
        ),
      );
    });
  });
}

async function main() {
  const [
    { buildAndroid },
    { createAndroidEnvironment, parseAdbDevices, resolveAndroidSdkRoot },
  ] = await Promise.all([
    import("./build-android-development.mjs"),
    import("./start-development-client.mjs"),
  ]);
  const environment = createAndroidEnvironment(resolveAndroidSdkRoot());
  assertJavaAvailable(environment);
  await buildAndroid(mobileRoot, environment);
  const arguments_ = process.argv.slice(2);
  const deviceIndex = arguments_.indexOf("--device");
  const requested =
    deviceIndex < 0
      ? environment.STREAMFUSION_ANDROID_DEVICE
      : arguments_[deviceIndex + 1];
  const adb = path.join(
    environment.ANDROID_HOME,
    "platform-tools",
    process.platform === "win32" ? "adb.exe" : "adb",
  );
  const devices = spawnSync(adb, ["devices"], {
    env: environment,
    encoding: "utf8",
    windowsHide: true,
  });
  if (devices.error || devices.status !== 0)
    throw new Error("Android devices could not be read.");
  const available = parseAdbDevices(devices.stdout);
  const device =
    requested ?? (available.length === 1 ? available[0] : undefined);
  if (!device || !available.includes(device))
    throw new Error(
      "Select a connected Android device with --device or STREAMFUSION_ANDROID_DEVICE.",
    );
  await run(
    adb,
    [
      "-s",
      device,
      "install",
      "-r",
      path.join(
        mobileRoot,
        "android/app/build/outputs/apk/debug/app-debug.apk",
      ),
    ],
    mobileRoot,
    environment,
  );
  if (!arguments_.includes("--no-packager")) {
    await run(
      process.execPath,
      [path.join(mobileRoot, "scripts/start-development-client.mjs")],
      mobileRoot,
      { ...environment, STREAMFUSION_ANDROID_DEVICE: device },
    );
  } else {
    const config = JSON.parse(
      readFileSync(path.join(mobileRoot, "native-config.json"), "utf8"),
    );
    await run(
      adb,
      ["-s", device, "reverse", "tcp:8083", "tcp:8083"],
      mobileRoot,
      environment,
    );
    await run(
      adb,
      [
        "-s",
        device,
        "shell",
        "am",
        "start",
        "-W",
        "-n",
        config.android.package + "/.MainActivity",
      ],
      mobileRoot,
      environment,
    );
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
