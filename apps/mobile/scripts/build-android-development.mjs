import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const javaPreflightTimeoutMs = 10_000;

export function assertJavaAvailable(
  environment = process.env,
  platform = process.platform,
  run = spawnSync,
) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const javaExecutable = environment.JAVA_HOME
    ? pathApi.join(
        environment.JAVA_HOME,
        "bin",
        platform === "win32" ? "java.exe" : "java",
      )
    : platform === "win32"
      ? "java.exe"
      : "java";
  const result = run(javaExecutable, ["-version"], {
    env: environment,
    stdio: "ignore",
    timeout: javaPreflightTimeoutMs,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      "Java is required before Android build. Set JAVA_HOME to a working JDK or put java on PATH.",
    );
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const mobileRoot = path.resolve(path.dirname(scriptPath), "..");

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

export async function buildAndroid(
  root,
  environment = process.env,
  dependencies = {
    assertJava: assertJavaAvailable,
    exists: existsSync,
    runCommand: runBuildCommand,
  },
) {
  dependencies.assertJava(environment);
  const gradleRoot = path.join(root, "android");
  const gradleExecutable = path.join(
    gradleRoot,
    process.platform === "win32" ? "gradlew.bat" : "gradlew",
  );
  if (!dependencies.exists(gradleExecutable)) {
    throw new Error(`The owned Android project is missing ${gradleExecutable}`);
  }

  const gradleCommand =
    process.platform === "win32"
      ? (process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe")
      : gradleExecutable;
  const gradleArguments =
    process.platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          ".\\gradlew.bat app:assembleDebug -PreactNativeDevServerPort=8083",
        ]
      : ["app:assembleDebug", "-PreactNativeDevServerPort=8083"];

  await dependencies.runCommand(
    gradleCommand,
    gradleArguments,
    gradleRoot,
    environment,
  );
}

export async function main(
  root = mobileRoot,
  environment = process.env,
  build = buildAndroid,
) {
  await build(root, environment);

  console.log(
    path.join(
      root,
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
