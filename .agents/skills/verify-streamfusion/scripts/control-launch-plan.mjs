import path from "node:path";

export const VERIFICATION_LAUNCHERS = Object.freeze({
  "dev:electron": Object.freeze({
    launcher: Object.freeze({
      mode: "dev:electron",
      command: "npm start",
      selection: 1,
    }),
    npmPrefix: Object.freeze(["start"]),
    readinessTimeoutMs: 120_000,
  }),
  preview: Object.freeze({
    launcher: Object.freeze({ mode: "preview", command: "npm run preview" }),
    npmPrefix: Object.freeze(["run", "preview", "--"]),
    readinessTimeoutMs: 300_000,
  }),
});

function launchMode(mode) {
  const resolved = mode ?? "dev:electron";
  if (!Object.hasOwn(VERIFICATION_LAUNCHERS, resolved)) {
    throw new Error(`Unknown verification launch mode: ${resolved}`);
  }
  return resolved;
}

function assertElectronArguments(electronArgs) {
  for (const argument of electronArgs) {
    if (
      argument === "--user-data-dir" ||
      argument === "--remote-debugging-port" ||
      argument.startsWith("--user-data-dir=") ||
      argument.startsWith("--remote-debugging-port=")
    ) {
      throw new Error(
        `Electron argument ${argument} is reserved by the verification controller`,
      );
    }
  }
}

function npmCommand(npmArguments, host) {
  if (host.platform !== "win32") {
    return Object.freeze({ command: "npm", args: Object.freeze(npmArguments) });
  }

  const npmCli =
    host.env.npm_execpath ??
    path.win32.join(
      path.win32.dirname(host.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
  return Object.freeze({
    command: host.execPath,
    args: Object.freeze([npmCli, ...npmArguments]),
  });
}

export function createVerificationLaunchPlan(
  request,
  host = {
    platform: process.platform,
    execPath: process.execPath,
    env: process.env,
  },
) {
  const mode = launchMode(request.mode);
  const electronArgs = [...(request.electronArgs ?? [])];
  assertElectronArguments(electronArgs);
  const launcher = VERIFICATION_LAUNCHERS[mode];
  const npmArguments = [
    ...launcher.npmPrefix,
    "--",
    `--remote-debugging-port=${request.port}`,
    `--user-data-dir=${request.profileDir}`,
    ...electronArgs,
  ];
  const executable = npmCommand(npmArguments, {
    platform: host.platform ?? process.platform,
    execPath: host.execPath ?? process.execPath,
    env: host.env ?? process.env,
  });
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = host.env ?? process.env;

  return Object.freeze({
    launcher: launcher.launcher,
    command: executable.command,
    args: executable.args,
    env: Object.freeze(env),
    readinessTimeoutMs: launcher.readinessTimeoutMs,
  });
}

export function waitForChildExitOrSignal(child, signalSource = process) {
  if (
    (child.exitCode !== null && child.exitCode !== undefined) ||
    child.signalCode
  ) {
    return Promise.resolve({
      code: child.exitCode ?? 1,
      signal: child.signalCode ?? null,
    });
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      signalSource.removeListener("SIGINT", onInterrupt);
      signalSource.removeListener("SIGTERM", onTerminate);
      resolve(result);
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      child.removeListener("exit", onExit);
      signalSource.removeListener("SIGINT", onInterrupt);
      signalSource.removeListener("SIGTERM", onTerminate);
      reject(error);
    };
    const onExit = (code, signal) =>
      finish({ code: code ?? (signal ? 1 : 0), signal: signal ?? null });
    const onInterrupt = () => finish({ code: 130, signal: "SIGINT" });
    const onTerminate = () => finish({ code: 143, signal: "SIGTERM" });
    child.once("error", onError);
    child.once("exit", onExit);
    signalSource.once("SIGINT", onInterrupt);
    signalSource.once("SIGTERM", onTerminate);
  });
}

export async function runManagedVerificationSession(
  request,
  { launch, cleanup, waitForExit = waitForChildExitOrSignal },
) {
  let launched;
  try {
    launched = await launch(request);
    return await waitForExit(launched.child);
  } finally {
    if (launched) await cleanup(launched.state);
  }
}

export async function runVerificationSmoke(
  request,
  { launch, inspect, cleanup },
) {
  let launched;
  try {
    launched = await launch(request);
    return await inspect(launched.state);
  } finally {
    if (launched) await cleanup(launched.state);
  }
}

export function isVerificationHealthy({
  processAlive,
  portOwned,
  page,
  accountStorageErrors,
  uncaughtErrors,
  currentVersion,
  launchedVersion,
}) {
  return (
    processAlive &&
    portOwned &&
    page.title === "StreamFusion" &&
    page.bridgeAvailable &&
    page.bodyReady &&
    page.sidebarReady &&
    accountStorageErrors.length === 0 &&
    uncaughtErrors.length === 0 &&
    currentVersion === launchedVersion
  );
}
