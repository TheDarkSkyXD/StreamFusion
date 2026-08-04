/**
 * Exercises the same renderer LOG_WRITE payload path used by live proof
 * sentinels without replacing electron-log's console transport writeFn.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

vi.unmock("@/backend/logging/logger");
vi.unmock("@/backend/logging/native-stderr-intercept");

vi.mock("electron", () => ({
  app: {
    getPath: () => os.tmpdir(),
    getName: () => "streamfusion",
    getVersion: () => "0.0.0-test",
    isReady: () => true,
    isPackaged: false,
    once: () => undefined,
    on: () => undefined,
    off: () => undefined,
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  BrowserWindow: { getAllWindows: () => [] },
  webContents: { getAllWebContents: () => [] },
  session: { defaultSession: null },
  shell: { openExternal: async () => undefined, openPath: vi.fn().mockResolvedValue("") },
  dialog: { showErrorBox: () => undefined },
}));

vi.mock("@/backend/ipc/sender-origin", () => ({
  isAllowedSender: vi.fn(() => true),
}));

type SendListener = (event: unknown, payload: unknown) => void;

const realStderrWrite = process.stderr.write;
const realStdoutWrite = process.stdout.write;
let tmpDir = "";

afterEach(() => {
  process.stderr.write = realStderrWrite;
  process.stdout.write = realStdoutWrite;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = "";
  vi.clearAllMocks();
});

// Guards: renderer levels persist once while only errors reach the original terminal writer once
describe("renderer LOG_WRITE terminal integration", () => {
  it("writes renderer info/warn/error once to the file and only error once to stderr", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sf-renderer-terminal-"));
    const stderrWrite = vi.fn().mockReturnValue(true);
    process.stderr.write = stderrWrite as unknown as typeof process.stderr.write;

    vi.resetModules();
    const { ipcMain } = await import("electron");
    const { initLogger, shutdownLogger } = await import("@/backend/logging/logger");
    const { installConsoleIntercept } = await import("@/backend/logging/console-intercept");
    const { installNativeStderrIntercept } =
      await import("@/backend/logging/native-stderr-intercept");
    const { registerLogHandlers } = await import("@/backend/ipc/handlers/log-handlers");

    initLogger({
      logsDir: tmpDir,
      sessionStamp: "2026-08-03T20:50:00.000Z",
    });
    const uninstallConsole = installConsoleIntercept();
    const uninstallNative = installNativeStderrIntercept();

    try {
      registerLogHandlers();
      const registration = vi
        .mocked(ipcMain.on)
        .mock.calls.find(([channel]) => channel === IPC_CHANNELS.LOG_WRITE);
      if (!registration) throw new Error("LOG_WRITE listener was not registered");
      const listener = registration[1] as SendListener;

      listener(
        { senderFrame: { url: "file:///C:/app/out/renderer/index.html" } },
        {
          level: "info",
          tag: "TerminalFilterProof",
          message: "RENDERER_MAIN_TERMINAL_INFO",
          meta: { proof: "terminal-filter" },
        }
      );
      listener(
        { senderFrame: { url: "file:///C:/app/out/renderer/index.html" } },
        {
          level: "warn",
          tag: "TerminalFilterProof",
          message: "RENDERER_MAIN_TERMINAL_WARN",
          meta: { proof: "terminal-filter" },
        }
      );
      listener(
        { senderFrame: { url: "file:///C:/app/out/renderer/index.html" } },
        {
          level: "error",
          tag: "TerminalFilterProof",
          message: "RENDERER_MAIN_TERMINAL_ERROR",
          meta: { proof: "terminal-filter" },
        }
      );

      const fileLines = fs
        .readFileSync(path.join(tmpDir, "streamfusion-2026-08-03T20-50-00-000Z.log"), "utf8")
        .split(/\r?\n/)
        .filter((line) => line.includes("RENDERER_MAIN_TERMINAL_"));
      const terminalWrites = stderrWrite.mock.calls.filter(([chunk]) =>
        String(chunk).includes("RENDERER_MAIN_TERMINAL_")
      );

      expect(fileLines).toHaveLength(3);
      expect(fileLines.filter((line) => line.includes("RENDERER_MAIN_TERMINAL_INFO"))).toHaveLength(
        1
      );
      expect(fileLines.filter((line) => line.includes("RENDERER_MAIN_TERMINAL_WARN"))).toHaveLength(
        1
      );
      expect(
        fileLines.filter((line) => line.includes("RENDERER_MAIN_TERMINAL_ERROR"))
      ).toHaveLength(1);
      expect(fileLines.find((line) => line.includes("RENDERER_MAIN_TERMINAL_ERROR"))).toContain(
        '[error] [Renderer:TerminalFilterProof] RENDERER_MAIN_TERMINAL_ERROR {"proof":"terminal-filter"}'
      );
      expect(terminalWrites).toHaveLength(1);
      expect(String(terminalWrites[0]?.[0])).toContain("RENDERER_MAIN_TERMINAL_ERROR");
    } finally {
      uninstallNative();
      uninstallConsole();
      await shutdownLogger();
    }
  });
});
