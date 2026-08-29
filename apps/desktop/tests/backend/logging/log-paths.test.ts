import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeLogPaths } from "@backend/logging/log-paths";

// Guards: each target Platform uses its own path semantics regardless of the CI runner's host OS
// Guards: writable Windows installs keep diagnostics beside the app while macOS and Linux use app-data fallbacks

describe("computeLogPaths — dev (!isPackaged)", () => {
  it("returns repo-root /.logs and /bug-reports when projectRoot is supplied", () => {
    const projectRoot = path.win32.join("C:\\", "repos", "StreamFusion");
    const result = computeLogPaths({
      isPackaged: false,
      platform: "win32",
      exePath: path.win32.join(projectRoot, "node_modules", ".bin", "electron.exe"),
      fallbackLogsPath: path.win32.join(
        "C:\\",
        "Users",
        "test",
        "AppData",
        "Roaming",
        "StreamFusion"
      ),
      projectRoot,
    });

    expect(result.logsDir).toBe(path.win32.join(projectRoot, ".logs"));
    expect(result.bugReportsDir).toBe(path.win32.join(projectRoot, "bug-reports"));
  });

  it("uses projectRoot regardless of platform in dev (linux)", () => {
    const projectRoot = "/home/dev/StreamFusion";
    const result = computeLogPaths({
      isPackaged: false,
      platform: "linux",
      exePath: "/home/dev/StreamFusion/node_modules/.bin/electron",
      fallbackLogsPath: "/home/dev/.config/StreamFusion",
      projectRoot,
    });

    expect(result.logsDir).toBe(path.posix.join(projectRoot, ".logs"));
    expect(result.bugReportsDir).toBe(path.posix.join(projectRoot, "bug-reports"));
  });

  it("throws a clear Error when projectRoot is missing in dev", () => {
    expect(() =>
      computeLogPaths({
        isPackaged: false,
        platform: "win32",
        exePath: "C:/whatever/electron.exe",
        fallbackLogsPath: "C:/Users/test/AppData/Roaming/StreamFusion",
      })
    ).toThrow(/projectRoot required in dev/);
  });
});

describe("computeLogPaths — prod windows (install dir is writable, perMachine:false)", () => {
  it("places logs and bug-reports inside the install dir derived from exePath", () => {
    const installDir = path.win32.join(
      "C:\\",
      "Users",
      "alice",
      "AppData",
      "Local",
      "Programs",
      "StreamFusion"
    );
    const exePath = path.win32.join(installDir, "StreamFusion.exe");
    const result = computeLogPaths({
      isPackaged: true,
      platform: "win32",
      exePath,
      fallbackLogsPath: path.win32.join(
        "C:\\",
        "Users",
        "alice",
        "AppData",
        "Roaming",
        "StreamFusion",
        "logs"
      ),
    });

    expect(result.logsDir).toBe(path.win32.join(installDir, "logs"));
    expect(result.bugReportsDir).toBe(path.win32.join(installDir, "bug-reports"));
  });

  it("does NOT touch fallbackLogsPath on prod windows even when supplied", () => {
    const installDir = path.win32.join("D:\\", "Apps", "StreamFusion");
    const exePath = path.win32.join(installDir, "StreamFusion.exe");
    const result = computeLogPaths({
      isPackaged: true,
      platform: "win32",
      exePath,
      fallbackLogsPath: path.win32.join(
        "C:\\",
        "Users",
        "alice",
        "AppData",
        "Roaming",
        "StreamFusion",
        "logs"
      ),
    });

    expect(result.logsDir.startsWith(installDir)).toBe(true);
    expect(result.bugReportsDir.startsWith(installDir)).toBe(true);
  });
});

describe("computeLogPaths — prod macOS (.app bundle is read-only)", () => {
  it("uses fallbackLogsPath verbatim for logsDir and a sibling bug-reports dir", () => {
    const exePath = "/Applications/StreamFusion.app/Contents/MacOS/StreamFusion";
    const fallbackLogsPath = "/Users/bob/Library/Logs/StreamFusion";
    const result = computeLogPaths({
      isPackaged: true,
      platform: "darwin",
      exePath,
      fallbackLogsPath,
    });

    expect(result.logsDir).toBe(fallbackLogsPath);
    expect(result.bugReportsDir).toBe(
      path.posix.join(path.posix.dirname(fallbackLogsPath), "bug-reports")
    );
  });
});

describe("computeLogPaths — prod linux (AppImage / /opt are read-only)", () => {
  it("uses fallbackLogsPath verbatim for logsDir and a sibling bug-reports dir", () => {
    const exePath = "/opt/StreamFusion/streamfusion";
    const fallbackLogsPath = "/home/carol/.config/StreamFusion/logs";
    const result = computeLogPaths({
      isPackaged: true,
      platform: "linux",
      exePath,
      fallbackLogsPath,
    });

    expect(result.logsDir).toBe(fallbackLogsPath);
    expect(result.bugReportsDir).toBe(
      path.posix.join(path.posix.dirname(fallbackLogsPath), "bug-reports")
    );
  });
});

describe("computeLogPaths — bug-reports state", () => {
  it("returns absolute paths in every environment", () => {
    const dev = computeLogPaths({
      isPackaged: false,
      platform: "win32",
      exePath: "C:/whatever/electron.exe",
      fallbackLogsPath: "C:/fallback",
      projectRoot: "C:/repos/StreamFusion",
    });
    const prodWin = computeLogPaths({
      isPackaged: true,
      platform: "win32",
      exePath: "C:/Programs/StreamFusion/StreamFusion.exe",
      fallbackLogsPath: "C:/fallback",
    });
    const prodMac = computeLogPaths({
      isPackaged: true,
      platform: "darwin",
      exePath: "/Applications/StreamFusion.app/Contents/MacOS/StreamFusion",
      fallbackLogsPath: "/Users/me/Library/Logs/StreamFusion",
    });

    expect(path.win32.isAbsolute(dev.logsDir)).toBe(true);
    expect(path.win32.isAbsolute(dev.bugReportsDir)).toBe(true);
    expect(path.win32.isAbsolute(prodWin.logsDir)).toBe(true);
    expect(path.win32.isAbsolute(prodWin.bugReportsDir)).toBe(true);
    expect(path.posix.isAbsolute(prodMac.logsDir)).toBe(true);
    expect(path.posix.isAbsolute(prodMac.bugReportsDir)).toBe(true);
  });
});
