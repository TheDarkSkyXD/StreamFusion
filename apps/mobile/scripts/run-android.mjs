import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  realpathSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const driveCandidates = ["S", "R", "Q", "P", "O", "N", "M", "L"];
const javaPreflightTimeoutMs = 10_000;
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

export function resolveMobileExpoCli(
  mobileDirectory = mobileRoot,
  repositoryDirectory = repositoryRoot,
) {
  const mobilePackage = path.join(mobileDirectory, "package.json");
  const expoCli = createRequire(mobilePackage).resolve("expo/bin/cli");
  relativeTaskPath(repositoryDirectory, expoCli);
  return expoCli;
}

export function mapWorktreePathToDriveLease(targetPath, lease) {
  const relativePath = relativeTaskPath(lease.repositoryRoot, targetPath);
  return path.win32.join(`${lease.drive}:\\`, relativePath);
}

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
      "Java is required before Android prebuild. Set JAVA_HOME to a working JDK or put java on PATH.",
    );
  }
}

function normalizeTarget(target) {
  return path.win32
    .normalize(target)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

export function parseSubstMappings(output) {
  const mappings = new Map();

  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^([a-z]):\\: => (.+)$/iu);
    if (match) {
      mappings.set(match[1].toUpperCase(), match[2]);
    }
  }

  return mappings;
}

function runSubst(args) {
  const result = spawnSync("subst", args, {
    encoding: "utf8",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function lockPath(drive) {
  return path.join(tmpdir(), `streamfusion-mobile-android-${drive}.lock.json`);
}

const systemDependencies = {
  candidates: driveCandidates,
  createLock(drive, record) {
    const target = lockPath(drive);
    let descriptor;

    try {
      descriptor = openSync(target, "wx");
      writeFileSync(descriptor, JSON.stringify(record), "utf8");
      return true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        return false;
      }
      throw error;
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
    }
  },
  createToken: randomUUID,
  deleteLock(drive) {
    try {
      unlinkSync(lockPath(drive));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  },
  driveExists(drive) {
    return existsSync(`${drive}:\\`);
  },
  isProcessAlive(processId) {
    try {
      process.kill(processId, 0);
      return true;
    } catch (error) {
      return error?.code === "EPERM";
    }
  },
  listMappings() {
    const result = runSubst([]);
    if (result.status !== 0) {
      throw new Error(
        result.stderr.trim() || "Unable to inspect drive mappings",
      );
    }
    return parseSubstMappings(result.stdout);
  },
  mapDrive(drive, target) {
    return runSubst([`${drive}:`, target]).status === 0;
  },
  processId: process.pid,
  readLock(drive) {
    try {
      return JSON.parse(readFileSync(lockPath(drive), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return undefined;
      }
      return null;
    }
  },
  unmapDrive(drive) {
    return runSubst([`${drive}:`, "/d"]).status === 0;
  },
};

function sameTarget(left, right) {
  return normalizeTarget(left) === normalizeTarget(right);
}

function reconcileStaleLease(drive, dependencies) {
  const lock = dependencies.readLock(drive);
  if (lock === undefined) {
    return true;
  }

  if (
    Number.isInteger(lock?.processId) &&
    dependencies.isProcessAlive(lock.processId)
  ) {
    return false;
  }

  const mappedTarget = dependencies.listMappings().get(drive);
  if (
    mappedTarget &&
    typeof lock?.repositoryRoot === "string" &&
    sameTarget(mappedTarget, lock.repositoryRoot)
  ) {
    if (!dependencies.unmapDrive(drive)) {
      return false;
    }
    if (dependencies.listMappings().has(drive)) {
      return false;
    }
  }

  dependencies.deleteLock(drive);
  return true;
}

function rollbackUnverifiedMapping(drive, targetRepositoryRoot, dependencies) {
  const mappedTarget = dependencies.listMappings().get(drive);
  if (mappedTarget && sameTarget(mappedTarget, targetRepositoryRoot)) {
    if (!dependencies.unmapDrive(drive)) {
      throw new Error(`Unable to roll back temporary Android drive ${drive}:`);
    }

    const remainingTarget = dependencies.listMappings().get(drive);
    if (remainingTarget && sameTarget(remainingTarget, targetRepositoryRoot)) {
      throw new Error(`Temporary Android drive ${drive}: is still mapped`);
    }
  }

  dependencies.deleteLock(drive);
}

export function acquireWindowsDrive(targetRepositoryRoot, overrides = {}) {
  const dependencies = { ...systemDependencies, ...overrides };

  for (const drive of dependencies.candidates) {
    if (!reconcileStaleLease(drive, dependencies)) {
      continue;
    }

    if (
      dependencies.listMappings().has(drive) ||
      dependencies.driveExists(drive)
    ) {
      continue;
    }

    const token = dependencies.createToken();
    const record = {
      processId: dependencies.processId,
      repositoryRoot: targetRepositoryRoot,
      token,
    };

    if (!dependencies.createLock(drive, record)) {
      continue;
    }

    if (
      dependencies.listMappings().has(drive) ||
      dependencies.driveExists(drive) ||
      !dependencies.mapDrive(drive, targetRepositoryRoot)
    ) {
      dependencies.deleteLock(drive);
      continue;
    }

    const mappedTarget = dependencies.listMappings().get(drive);
    if (mappedTarget && sameTarget(mappedTarget, targetRepositoryRoot)) {
      return {
        dependencies,
        drive,
        repositoryRoot: targetRepositoryRoot,
        token,
      };
    }

    rollbackUnverifiedMapping(drive, targetRepositoryRoot, dependencies);
  }

  throw new Error(
    `Unable to reserve a short Windows drive from ${dependencies.candidates.join(", ")}. Existing drives and mappings were left unchanged.`,
  );
}

export function releaseWindowsDrive(lease) {
  const {
    dependencies,
    drive,
    repositoryRoot: targetRepositoryRoot,
    token,
  } = lease;
  const lock = dependencies.readLock(drive);

  if (lock?.token !== token) {
    return false;
  }

  const mappedTarget = dependencies.listMappings().get(drive);
  if (mappedTarget && sameTarget(mappedTarget, targetRepositoryRoot)) {
    if (!dependencies.unmapDrive(drive)) {
      throw new Error(`Unable to remove temporary Android drive ${drive}:`);
    }
    const remainingTarget = dependencies.listMappings().get(drive);
    if (remainingTarget && sameTarget(remainingTarget, targetRepositoryRoot)) {
      throw new Error(`Temporary Android drive ${drive}: is still mapped`);
    }
  }

  dependencies.deleteLock(drive);
  return true;
}

export async function runWithDriveLease(lease, operation) {
  let operationError;

  try {
    await operation();
  } catch (error) {
    operationError = error;
  }

  try {
    releaseWindowsDrive(lease);
  } catch (cleanupError) {
    if (!operationError) {
      throw cleanupError;
    }
    console.error(cleanupError);
  }

  if (operationError) {
    throw operationError;
  }
}

export function createMappedAndroidEnvironment(
  lease,
  currentEnvironment = process.env,
) {
  const mappedRepositoryRoot = `${lease.drive}:\\`;
  const mappedPreload = path.win32.join(
    mappedRepositoryRoot,
    "apps",
    "mobile",
    "scripts",
    "preserve-subst-paths.cjs",
  );

  return {
    ...currentEnvironment,
    NODE_OPTIONS: [
      currentEnvironment.NODE_OPTIONS,
      `--require=${mappedPreload}`,
    ]
      .filter(Boolean)
      .join(" "),
    STREAMFUSION_SUBST_DRIVE_ROOT: mappedRepositoryRoot,
    STREAMFUSION_SUBST_TARGET_ROOT: lease.repositoryRoot,
  };
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
  const androidArguments = ["run:android", ...process.argv.slice(2)];
  assertJavaAvailable();
  const expoCli = resolveMobileExpoCli();

  if (process.platform !== "win32") {
    await run(process.execPath, [expoCli, ...androidArguments], mobileRoot);
    return;
  }

  const lease = acquireWindowsDrive(repositoryRoot);
  await runWithDriveLease(lease, () => {
    const mappedMobileRoot = mapWorktreePathToDriveLease(mobileRoot, lease);
    const mappedExpoCli = mapWorktreePathToDriveLease(expoCli, lease);
    const mappedEnvironment = createMappedAndroidEnvironment(lease);

    console.log(`Starting Android from ${mappedMobileRoot}`);
    return run(
      process.execPath,
      [mappedExpoCli, ...androidArguments],
      mappedMobileRoot,
      mappedEnvironment,
    );
  });
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
