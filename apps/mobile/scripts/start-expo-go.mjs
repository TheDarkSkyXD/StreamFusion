import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const mobileRoot = path.resolve(path.dirname(scriptPath), "..");
const expoGoPackage = "host.exp.exponent";
const metroPort = 8081;

function defaultSdkCandidates(platform, home) {
  if (platform === "win32") {
    return [path.win32.join(home, "AppData", "Local", "Android", "Sdk")];
  }
  if (platform === "darwin") {
    return [path.posix.join(home, "Library", "Android", "sdk")];
  }
  if (platform === "linux") {
    return [
      path.posix.join(home, "Android", "Sdk"),
      path.posix.join(home, "Android", "sdk"),
    ];
  }
  return [];
}

export function resolveAndroidSdkRoot({
  environment = process.env,
  home = homedir(),
  pathExists = existsSync,
  platform = process.platform,
} = {}) {
  for (const variable of ["ANDROID_HOME", "ANDROID_SDK_ROOT"]) {
    const configuredPath = environment[variable];
    if (!configuredPath) continue;
    if (!pathExists(configuredPath)) {
      throw new Error(
        `${variable} points to a missing Android SDK: ${configuredPath}`,
      );
    }
    return configuredPath;
  }

  const sdkRoot = defaultSdkCandidates(platform, home).find(pathExists);
  if (sdkRoot) return sdkRoot;

  throw new Error(
    "Android SDK not found. Install Android Studio or set ANDROID_HOME to the SDK directory.",
  );
}

export function createAndroidEnvironment(
  sdkRoot,
  currentEnvironment = process.env,
  platform = process.platform,
) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const separator = platform === "win32" ? ";" : ":";
  const pathKey =
    Object.keys(currentEnvironment).find(
      (key) => key.toLowerCase() === "path",
    ) ?? "PATH";
  const existingPath = currentEnvironment[pathKey];
  const androidPaths = [
    pathApi.join(sdkRoot, "emulator"),
    pathApi.join(sdkRoot, "platform-tools"),
  ];
  if (existingPath) androidPaths.push(existingPath);

  return {
    ...currentEnvironment,
    ANDROID_HOME: sdkRoot,
    ANDROID_SDK_ROOT: sdkRoot,
    [pathKey]: androidPaths.join(separator),
  };
}

export function createExpoGoArguments(forwardArguments = [], port = metroPort) {
  return [
    "start",
    "--go",
    "--offline",
    "--port",
    String(port),
    ...forwardArguments,
  ];
}

export function parseAdbDevices(output) {
  return output
    .split(/\r?\n/u)
    .map((line) => line.match(/^(\S+)\s+device(?:\s|$)/u)?.[1])
    .filter(Boolean);
}

export function createExpoGoIntentArguments(
  port = metroPort,
  host = "127.0.0.1",
) {
  return [
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `exp://${host}:${port}`,
    expoGoPackage,
  ];
}

function executablePath(sdkRoot, directory, executable, platform) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const suffix = platform === "win32" ? ".exe" : "";
  return pathApi.join(sdkRoot, directory, `${executable}${suffix}`);
}

function runChecked(command, args, environment) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: environment,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `${command} exited with code ${result.status ?? 1}`,
    );
  }
  return result.stdout;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findReadyAndroidDevice(adb, environment) {
  const devices = parseAdbDevices(runChecked(adb, ["devices"], environment));
  for (const device of devices) {
    const bootCompleted = runChecked(
      adb,
      ["-s", device, "shell", "getprop", "sys.boot_completed"],
      environment,
    ).trim();
    if (bootCompleted === "1") return device;
  }
  return undefined;
}

function hasEmulatorNetwork(adb, device, environment) {
  if (!device.startsWith("emulator-")) return true;
  return /\sinet\s/u.test(
    runChecked(
      adb,
      ["-s", device, "shell", "ip", "-4", "addr", "show", "wlan0"],
      environment,
    ),
  );
}

async function ensureAndroidDevice({
  sdkRoot,
  environment,
  platform = process.platform,
  timeoutMilliseconds = 55_000,
}) {
  const adb = executablePath(sdkRoot, "platform-tools", "adb", platform);
  const emulator = executablePath(sdkRoot, "emulator", "emulator", platform);
  runChecked(adb, ["start-server"], environment);

  const readyDevice = await findReadyAndroidDevice(adb, environment);
  if (readyDevice && hasEmulatorNetwork(adb, readyDevice, environment)) {
    return { adb, device: readyDevice, started: false };
  }

  const avds = runChecked(emulator, ["-list-avds"], environment)
    .split(/\r?\n/u)
    .map((name) => name.trim())
    .filter(Boolean);
  const requestedAvd = environment.STREAMFUSION_ANDROID_AVD;
  const avd = requestedAvd || avds[0];
  if (!avd || (requestedAvd && !avds.includes(requestedAvd))) {
    throw new Error(
      requestedAvd
        ? `Android emulator ${requestedAvd} is not installed.`
        : "No Android emulator is installed. Create one in Android Studio first.",
    );
  }

  console.log(`Starting Android emulator ${avd}...`);
  const emulatorProcess = spawn(emulator, [`@${avd}`, "-no-boot-anim"], {
    detached: true,
    env: environment,
    stdio: "ignore",
  });
  emulatorProcess.unref();

  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    await delay(500);
    try {
      const device = await findReadyAndroidDevice(adb, environment);
      if (device && hasEmulatorNetwork(adb, device, environment)) {
        return { adb, device, started: true };
      }
    } catch {
      // ADB can briefly reject commands while the emulator is attaching.
    }
  }

  throw new Error(
    `Android emulator ${avd} did not finish booting within ${Math.round(timeoutMilliseconds / 1000)} seconds.`,
  );
}

async function waitForMetro(port, timeoutMilliseconds = 30_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`);
      if ((await response.text()).includes("packager-status:running")) return;
    } catch {
      // Metro is still starting.
    }
    await delay(250);
  }
  throw new Error(
    `Metro did not start within ${timeoutMilliseconds / 1000} seconds.`,
  );
}

function rejectIfProcessExits(child, name) {
  return new Promise((_, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `${name} exited before it was ready (${signal ? `signal ${signal}` : `code ${code ?? 1}`}).`,
        ),
      );
    });
  });
}

function waitForExit(child, wasStopped) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (
        code === 0 ||
        signal === "SIGINT" ||
        signal === "SIGTERM" ||
        wasStopped()
      ) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Expo exited with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}`,
        ),
      );
    });
  });
}

async function main() {
  const sdkRoot = resolveAndroidSdkRoot();
  const environment = createAndroidEnvironment(sdkRoot);
  const expoCli = fileURLToPath(import.meta.resolve("expo/bin/cli"));
  const startedAt = Date.now();

  console.log(
    "Starting StreamFusion Mobile in Expo Go (native rebuild skipped).",
  );
  const metro = spawn(
    process.execPath,
    [expoCli, ...createExpoGoArguments(process.argv.slice(2))],
    { cwd: mobileRoot, env: environment, stdio: "inherit" },
  );
  let stopRequested = false;
  const stopMetro = () => {
    if (stopRequested || metro.exitCode !== null) return;
    stopRequested = true;
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/pid", String(metro.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      return;
    }
    metro.kill("SIGTERM");
  };
  process.once("SIGINT", stopMetro);
  process.once("SIGTERM", stopMetro);

  try {
    const [{ adb, device, started }] = await Promise.all([
      ensureAndroidDevice({ sdkRoot, environment }),
      Promise.race([
        waitForMetro(metroPort),
        rejectIfProcessExits(metro, "Metro"),
      ]),
    ]);
    runChecked(
      adb,
      ["-s", device, "reverse", `tcp:${metroPort}`, `tcp:${metroPort}`],
      environment,
    );
    const installedExpoGo = runChecked(
      adb,
      ["-s", device, "shell", "pm", "path", expoGoPackage],
      environment,
    );
    if (!installedExpoGo.trim()) {
      throw new Error(
        "Expo Go is not installed on the Android device. Install the SDK-compatible Expo Go app and retry.",
      );
    }
    const deviceHost = device.startsWith("emulator-")
      ? "10.0.2.2"
      : "127.0.0.1";
    runChecked(
      adb,
      [
        "-s",
        device,
        "shell",
        "am",
        "start",
        "-S",
        "-W",
        ...createExpoGoIntentArguments(metroPort, deviceHost),
      ],
      environment,
    );
    console.log(
      `Expo Go opened on ${device} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s${started ? " after cold boot" : ""}.`,
    );
    await waitForExit(metro, () => stopRequested);
  } catch (error) {
    stopMetro();
    throw error;
  } finally {
    process.off("SIGINT", stopMetro);
    process.off("SIGTERM", stopMetro);
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
