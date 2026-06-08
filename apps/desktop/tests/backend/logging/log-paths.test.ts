import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeLogPaths } from "@/backend/logging/log-paths";

// computeLogPaths is a pure function — the per-environment branch is the
// load-bearing decision (writeable install dir on Windows; .app/AppImage are
// read-only on mac/linux so we fall back to app.getPath('logs')).

describe("computeLogPaths — dev (!isPackaged)", () => {
  it("returns repo-root /.logs and /bug-reports when projectRoot is supplied", () => {
    const projectRoot = path.join("C:", "repos", "StreamFusion");
    const result = computeLogPaths({
      isPackaged: false,
      platform: "win32",
      exePath: path.join(projectRoot, "node_modules", ".bin", "electron.exe"),
      fallbackLogsPath: path.join("C:", "Users", "test", "AppData", "Roaming", "StreamFusion"),
      projectRoot,
    });

    expect(result.logsDir).toBe(path.join(projectRoot, ".logs"));
    expect(result.bugReportsDir).toBe(path.join(projectRoot, "bug-reports"));
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

    expect(result.logsDir).toBe(path.join(projectRoot, ".logs"));
    expect(result.bugReportsDir).toBe(path.join(projectRoot, "bug-reports"));
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
    const installDir = path.join(
      "C:",
      "Users",
      "alice",
      "AppData",
      "Local",
      "Programs",
      "StreamFusion"
    );
    const exePath = path.join(installDir, "StreamFusion.exe");
    const result = computeLogPaths({
      isPackaged: true,
      platform: "win32",
      exePath,
      fallbackLogsPath: path.join(
        "C:",
        "Users",
        "alice",
        "AppData",
        "Roaming",
        "StreamFusion",
        "logs"
      ),
    });

    expect(result.logsDir).toBe(path.join(installDir, "logs"));
    expect(result.bugReportsDir).toBe(path.join(installDir, "bug-reports"));
  });

  it("does NOT touch fallbackLogsPath on prod windows even when supplied", () => {
    const installDir = path.join("D:", "Apps", "StreamFusion");
    const exePath = path.join(installDir, "StreamFusion.exe");
    const result = computeLogPaths({
      isPackaged: true,
      platform: "win32",
      exePath,
      fallbackLogsPath: path.join(
        "C:",
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
    expect(result.bugReportsDir).toBe(path.join(path.dirname(fallbackLogsPath), "bug-reports"));
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
    expect(result.bugReportsDir).toBe(path.join(path.dirname(fallbackLogsPath), "bug-reports"));
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

    expect(path.isAbsolute(dev.logsDir)).toBe(true);
    expect(path.isAbsolute(dev.bugReportsDir)).toBe(true);
    expect(path.isAbsolute(prodWin.logsDir)).toBe(true);
    expect(path.isAbsolute(prodWin.bugReportsDir)).toBe(true);
    expect(path.isAbsolute(prodMac.logsDir)).toBe(true);
    expect(path.isAbsolute(prodMac.bugReportsDir)).toBe(true);
  });
});
