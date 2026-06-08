/**
 * Resolution of the on-disk log + bug-report directories.
 *
 * Three cases drive the branching:
 *   - Dev (!isPackaged): write into the workspace so logs survive `git clean`
 *     review and stay grep-able from the editor. Caller passes projectRoot
 *     because the dev launcher (electron-vite) does not anchor cwd reliably.
 *   - Prod Windows (NSIS perMachine:false): install dir lives under
 *     %LOCALAPPDATA%\Programs\StreamFusion\ and is user-writable by design, so
 *     putting logs there keeps them co-located with the binary they describe.
 *   - Prod macOS / Linux: the install location is read-only (signed .app
 *     bundle on mac; AppImage / /opt on linux). Writing there would either
 *     silently fail or break code signing — fall back to app.getPath('logs').
 *
 * Pure function: no fs / electron imports here so the resolution rules are
 * unit-testable without spinning up the Electron app.
 */

import path from "node:path";

export interface LogPaths {
  /** Absolute path of the directory the logger should write into. */
  logsDir: string;
  /** Sibling of logsDir — bug-report markdown files are written here. */
  bugReportsDir: string;
  /** Platform-health telemetry JSONL files. */
  telemetryDir: string;
}

export interface ComputeLogPathsOpts {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  /** `app.getPath('exe')` — used to derive the install dir on Windows. */
  exePath: string;
  /**
   * `app.getPath('logs')` — used as the fallback location on mac/linux prod
   * builds where the install dir is read-only.
   */
  fallbackLogsPath: string;
  /** Required when `!isPackaged`. Repo root that hosts /logs and /bug-reports. */
  projectRoot?: string;
}

export function computeLogPaths(opts: ComputeLogPathsOpts): LogPaths {
  if (!opts.isPackaged) {
    if (!opts.projectRoot) {
      throw new Error("projectRoot required in dev");
    }
    // Dev uses a dot-prefixed `.logs/` so the folder is hidden in file
    // browsers and easy to gitignore distinct from the catch-all `*.log`
    // pattern. Prod paths stay unprefixed — they live in install / app-data
    // dirs where the hidden-dot convention doesn't help.
    return {
      logsDir: path.join(opts.projectRoot, ".logs"),
      bugReportsDir: path.join(opts.projectRoot, "bug-reports"),
      telemetryDir: path.join(opts.projectRoot, "telemetry"),
    };
  }

  if (opts.platform === "win32") {
    const installDir = path.dirname(opts.exePath);
    return {
      logsDir: path.join(installDir, "logs"),
      bugReportsDir: path.join(installDir, "bug-reports"),
      telemetryDir: path.join(installDir, "stream health telemetry"),
    };
  }

  // mac / linux prod: install location is read-only — sibling under the
  // fallback path keeps the dev/win invariant that bug-reports is a sibling
  // of logs.
  const fallbackParent = path.dirname(opts.fallbackLogsPath);
  return {
    logsDir: opts.fallbackLogsPath,
    bugReportsDir: path.join(fallbackParent, "bug-reports"),
    telemetryDir: path.join(fallbackParent, "stream health telemetry"),
  };
}

// Module-level state so IPC handlers registered after main.ts boot can read
// the bug-reports directory without threading it through every call site.
// Set once during main.ts startup via `setBugReportsDir`; reads before set
// throw to surface boot-ordering bugs loudly rather than silently falling
// back to cwd.
let bugReportsDirState: string | null = null;

export function setBugReportsDir(dir: string): void {
  bugReportsDirState = dir;
}

export function getBugReportsDir(): string {
  if (bugReportsDirState === null) {
    throw new Error("bugReportsDir is not initialized — call setBugReportsDir() first.");
  }
  return bugReportsDirState;
}

let telemetryDirState: string | null = null;

export function setTelemetryDir(dir: string): void {
  telemetryDirState = dir;
}

export function getTelemetryDir(): string {
  if (telemetryDirState === null) {
    throw new Error("telemetryDir is not initialized — call setTelemetryDir() first.");
  }
  return telemetryDirState;
}
