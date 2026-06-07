import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

// Mirror the mock setup used by log-handlers.test.ts so every handler runs
// against a controllable ipcMain/shell pair.
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  shell: { openPath: vi.fn().mockResolvedValue("") },
  app: {
    getVersion: vi.fn(() => "1.0.0-beta.1"),
  },
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getCurrentLogPath: vi.fn(),
}));

vi.mock("@/backend/logging/noise-logger", () => ({
  getCurrentNoisePath: vi.fn(),
}));

vi.mock("@/backend/ipc/sender-origin", () => ({
  isAllowedSender: vi.fn(),
}));

import { app, ipcMain, shell } from "electron";

import { registerBugReportHandlers } from "@/backend/ipc/handlers/bug-report-handlers";
import { isAllowedSender } from "@/backend/ipc/sender-origin";
import { getCurrentLogPath } from "@/backend/logging/logger";
import { getCurrentNoisePath } from "@/backend/logging/noise-logger";
import type { BugReportResult } from "@/shared/ipc-channels";

type InvokeHandler = (event: unknown, args?: unknown) => unknown;

function getInvokeHandler(channel: string): InvokeHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, InvokeHandler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`invoke handler not registered: ${channel}`);
  return call[1];
}

const ALLOWED_FILE = { senderFrame: { url: "file:///C:/app/out/renderer/index.html" } };
const DISALLOWED_REMOTE = { senderFrame: { url: "https://www.twitch.tv/embed" } };

let tmpDir: string;
let bugReportsDir: string;
let mainLogPath: string;
let noiseLogPath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-bug-report-"));
  bugReportsDir = path.join(tmpDir, "bug-reports");
  mainLogPath = path.join(tmpDir, "streamfusion-main.log");
  noiseLogPath = path.join(tmpDir, "streamfusion-noise.log");
  vi.mocked(getCurrentLogPath).mockReturnValue(mainLogPath);
  vi.mocked(getCurrentNoisePath).mockReturnValue(noiseLogPath);
  vi.mocked(isAllowedSender).mockReturnValue(true);
  vi.mocked(shell.openPath).mockResolvedValue("");
  vi.mocked(app.getVersion).mockReturnValue("1.0.0-beta.1");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("registerBugReportHandlers — channel registration", () => {
  it("registers invoke handlers for all 4 bug-report channels", () => {
    registerBugReportHandlers(bugReportsDir);
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.BUG_REPORT_WRITE);
    expect(channels).toContain(IPC_CHANNELS.BUG_REPORT_OPEN_FOLDER);
    expect(channels).toContain(IPC_CHANNELS.BUG_REPORT_GET_DIR);
    expect(channels).toContain(IPC_CHANNELS.BUG_REPORT_LIST);
  });
});

describe("BUG_REPORT_WRITE — file write + content shape", () => {
  it("writes a markdown file in bugReportsDir and returns its absolute path", async () => {
    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_WRITE);

    const result = (await handler(ALLOWED_FILE, {
      description: "video stalls after 2 hours",
      includeMainLog: false,
      includeNoiseLog: false,
    })) as BugReportResult;

    expect(result.ok).toBe(true);
    expect(result.filePath).toBeDefined();
    expect(path.dirname(result.filePath ?? "")).toBe(bugReportsDir);
    expect(path.basename(result.filePath ?? "")).toMatch(/^bug-report-.+\.md$/);

    const content = await fs.readFile(result.filePath as string, "utf8");
    expect(content).toContain("# StreamFusion Bug Report");
    expect(content).toContain("video stalls after 2 hours");
    expect(content).toContain("- App version: 1.0.0-beta.1");
    expect(content).toContain("- Platform: ");
    expect(content).toContain("- Electron: ");
    expect(content).toContain("- Node: ");
    expect(content).toContain(`- Log file: ${mainLogPath}`);
    expect(content).toContain(`- Noise log: ${noiseLogPath}`);
  });

  it("creates bugReportsDir if it does not exist yet", async () => {
    // Nested dir simulates first-run condition before any prior write.
    const nestedDir = path.join(bugReportsDir, "subdir");
    registerBugReportHandlers(nestedDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_WRITE);

    const result = (await handler(ALLOWED_FILE, {
      description: "test",
      includeMainLog: false,
      includeNoiseLog: false,
    })) as BugReportResult;

    expect(result.ok).toBe(true);
    const stat = await fs.stat(nestedDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("includes the tail of the main log when includeMainLog=true", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 700; i++) lines.push(`main-line-${i}`);
    await fs.writeFile(mainLogPath, lines.join("\n"));

    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_WRITE);

    const result = (await handler(ALLOWED_FILE, {
      description: "x",
      includeMainLog: true,
      includeNoiseLog: false,
    })) as BugReportResult;

    expect(result.ok).toBe(true);
    const content = await fs.readFile(result.filePath as string, "utf8");
    expect(content).toContain("## Recent Main Log (last 500 lines)");
    // Includes the LAST line of the file, excludes the first (since tail=500).
    expect(content).toContain("main-line-699");
    expect(content).not.toContain("main-line-0\n");
    // Noise section omitted.
    expect(content).not.toContain("## Recent Noise Log");
  });

  it("includes the tail of the noise log when includeNoiseLog=true", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) lines.push(`noise-line-${i}`);
    await fs.writeFile(noiseLogPath, lines.join("\n"));

    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_WRITE);

    const result = (await handler(ALLOWED_FILE, {
      description: "x",
      includeMainLog: false,
      includeNoiseLog: true,
    })) as BugReportResult;

    expect(result.ok).toBe(true);
    const content = await fs.readFile(result.filePath as string, "utf8");
    expect(content).toContain("## Recent Noise Log (last 200 lines)");
    expect(content).toContain("noise-line-299");
    // Tail of 200 lines means line 99 should not appear.
    expect(content).not.toContain("noise-line-0\n");
    expect(content).not.toContain("## Recent Main Log");
  });

  it("omits the noise log gracefully when the noise logger is not initialized", async () => {
    vi.mocked(getCurrentNoisePath).mockImplementation(() => {
      throw new Error("Noise logger is not initialized");
    });

    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_WRITE);

    const result = (await handler(ALLOWED_FILE, {
      description: "x",
      includeMainLog: false,
      includeNoiseLog: true,
    })) as BugReportResult;

    expect(result.ok).toBe(true);
    const content = await fs.readFile(result.filePath as string, "utf8");
    expect(content).toContain("- Noise log: not initialized");
    // Section is still emitted but the body is a placeholder so the on-disk
    // file has a stable shape regardless of noise-logger state.
    expect(content).toContain("## Recent Noise Log (last 200 lines)");
    expect(content).toContain("noise logger not initialized");
  });

  it("REJECTS a disallowed sender origin — no file is written", async () => {
    vi.mocked(isAllowedSender).mockReturnValue(false);
    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_WRITE);

    const result = (await handler(DISALLOWED_REMOTE, {
      description: "evil",
      includeMainLog: false,
      includeNoiseLog: false,
    })) as BugReportResult;

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    // Directory may not exist at all (no file was written).
    const entries = await fs.readdir(bugReportsDir).catch(() => []);
    expect(entries).toEqual([]);
  });
});

describe("BUG_REPORT_OPEN_FOLDER", () => {
  it("calls shell.openPath with bugReportsDir and returns {ok:true}", async () => {
    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_OPEN_FOLDER);

    const result = (await handler(ALLOWED_FILE)) as { ok: boolean; error?: string };
    expect(shell.openPath).toHaveBeenCalledWith(bugReportsDir);
    expect(result).toEqual({ ok: true });
  });

  it("returns {ok:false,error} when shell.openPath reports a failure string", async () => {
    vi.mocked(shell.openPath).mockResolvedValue("Failed to open file: ENOENT");
    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_OPEN_FOLDER);

    const result = (await handler(ALLOWED_FILE)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to open file: ENOENT");
  });

  it("returns {ok:false,error} when shell.openPath throws", async () => {
    vi.mocked(shell.openPath).mockRejectedValue(new Error("boom"));
    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_OPEN_FOLDER);

    const result = (await handler(ALLOWED_FILE)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});

describe("BUG_REPORT_GET_DIR", () => {
  it("returns the bugReportsDir absolute path passed at register time", async () => {
    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_GET_DIR);
    const result = await handler(ALLOWED_FILE);
    expect(result).toBe(bugReportsDir);
  });
});

describe("BUG_REPORT_LIST", () => {
  it("returns an empty array when the directory is missing", async () => {
    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_LIST);
    const result = (await handler(ALLOWED_FILE)) as string[];
    expect(result).toEqual([]);
  });

  it("returns only bug-report-*.md files, newest first, capped at 50", async () => {
    await fs.mkdir(bugReportsDir, { recursive: true });
    const base = new Date("2026-06-01T00:00:00.000Z").getTime();
    // Create 60 matching files with monotonic mtimes (oldest first → indexes 0..59).
    const matching: string[] = [];
    for (let i = 0; i < 60; i++) {
      const name = `bug-report-2026-06-01T00-00-${String(i).padStart(2, "0")}-000Z.md`;
      const full = path.join(bugReportsDir, name);
      await fs.writeFile(full, "x");
      await fs.utimes(full, new Date(base + i * 1000), new Date(base + i * 1000));
      matching.push(full);
    }
    // Add files that should be filtered out.
    await fs.writeFile(path.join(bugReportsDir, "notes.txt"), "x");
    await fs.writeFile(path.join(bugReportsDir, "random.md"), "x");

    registerBugReportHandlers(bugReportsDir);
    const handler = getInvokeHandler(IPC_CHANNELS.BUG_REPORT_LIST);
    const result = (await handler(ALLOWED_FILE)) as string[];

    expect(result.length).toBe(50);
    // Newest first → the last-created file (index 59) appears at result[0].
    expect(result[0]).toBe(matching[59]);
    // The 50th survivor is index 10 (60 - 50).
    expect(result[49]).toBe(matching[10]);
    // No filtered files leaked in.
    expect(result.every((p) => path.basename(p).startsWith("bug-report-"))).toBe(true);
    expect(result.every((p) => path.extname(p) === ".md")).toBe(true);
  });
});
