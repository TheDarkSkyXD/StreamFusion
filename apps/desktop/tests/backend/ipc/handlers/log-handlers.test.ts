import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

// Capture ipcMain.handle / ipcMain.on registrations so we can invoke each log
// handler directly with a synthetic event (controlling senderFrame.url).
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  shell: { openPath: vi.fn().mockResolvedValue("") },
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

vi.mock("@/backend/logging/network-logger", () => ({
  getCurrentNetworkPath: vi.fn(),
}));

vi.mock("@/backend/ipc/sender-origin", () => ({
  isAllowedSender: vi.fn(),
}));

import { ipcMain, shell } from "electron";

import { registerLogHandlers } from "@/backend/ipc/handlers/log-handlers";
import { isAllowedSender } from "@/backend/ipc/sender-origin";
import { getCurrentLogPath, logger } from "@/backend/logging/logger";
import { getCurrentNetworkPath } from "@/backend/logging/network-logger";
import { getCurrentNoisePath } from "@/backend/logging/noise-logger";

const loggerMock = vi.mocked(logger);

type InvokeHandler = (event: unknown, args?: unknown) => unknown;
type SendListener = (event: unknown, args?: unknown) => void;

function getInvokeHandler(channel: string): InvokeHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, InvokeHandler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`invoke handler not registered: ${channel}`);
  return call[1];
}

function getSendListener(channel: string): SendListener {
  const calls = vi.mocked(ipcMain.on).mock.calls as unknown as Array<[string, SendListener]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`send listener not registered: ${channel}`);
  return call[1];
}

const ALLOWED_FILE = { senderFrame: { url: "file:///C:/app/out/renderer/index.html" } };
const DISALLOWED_REMOTE = { senderFrame: { url: "https://www.twitch.tv/embed" } };

let tmpDir: string;
let mainLogPath: string;
let noiseLogPath: string;
let networkLogPath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-log-handlers-"));
  mainLogPath = path.join(tmpDir, "streamfusion-main.log");
  noiseLogPath = path.join(tmpDir, "streamfusion-noise.log");
  networkLogPath = path.join(tmpDir, "streamfusion-network.log");
  vi.mocked(getCurrentLogPath).mockReturnValue(mainLogPath);
  vi.mocked(getCurrentNoisePath).mockReturnValue(noiseLogPath);
  vi.mocked(getCurrentNetworkPath).mockReturnValue(networkLogPath);
  vi.mocked(isAllowedSender).mockReturnValue(true);
  vi.mocked(shell.openPath).mockResolvedValue("");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("registerLogHandlers — channel registration", () => {
  it("registers a fire-and-forget listener for LOG_WRITE", () => {
    registerLogHandlers();
    const channels = vi.mocked(ipcMain.on).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.LOG_WRITE);
  });

  it("registers invoke handlers for LOGS_OPEN_FOLDER, LOGS_GET_CURRENT_PATH, LOGS_GET_NOISE_PATH, LOGS_GET_NETWORK_PATH, LOGS_TAIL", () => {
    registerLogHandlers();
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.LOGS_OPEN_FOLDER);
    expect(channels).toContain(IPC_CHANNELS.LOGS_GET_CURRENT_PATH);
    expect(channels).toContain(IPC_CHANNELS.LOGS_GET_NOISE_PATH);
    expect(channels).toContain(IPC_CHANNELS.LOGS_GET_NETWORK_PATH);
    expect(channels).toContain(IPC_CHANNELS.LOGS_TAIL);
  });
});

describe("LOG_WRITE — fire-and-forget renderer → main bridge", () => {
  it("routes a valid payload to logger.<level> with the Renderer: tag prefix", () => {
    registerLogHandlers();
    const listener = getSendListener(IPC_CHANNELS.LOG_WRITE);

    listener(ALLOWED_FILE, {
      level: "info",
      tag: "PlayerEvents",
      message: "stream started",
      meta: { channel: "xqc" },
    });

    expect(loggerMock.info).toHaveBeenCalledWith("Renderer:PlayerEvents", "stream started", {
      channel: "xqc",
    });
  });

  it("forwards each of the 4 valid levels (debug/info/warn/error)", () => {
    registerLogHandlers();
    const listener = getSendListener(IPC_CHANNELS.LOG_WRITE);

    listener(ALLOWED_FILE, { level: "debug", tag: "T", message: "d" });
    listener(ALLOWED_FILE, { level: "info", tag: "T", message: "i" });
    listener(ALLOWED_FILE, { level: "warn", tag: "T", message: "w" });
    listener(ALLOWED_FILE, { level: "error", tag: "T", message: "e" });

    expect(loggerMock.debug).toHaveBeenCalledWith("Renderer:T", "d", undefined);
    expect(loggerMock.info).toHaveBeenCalledWith("Renderer:T", "i", undefined);
    expect(loggerMock.warn).toHaveBeenCalledWith("Renderer:T", "w", undefined);
    expect(loggerMock.error).toHaveBeenCalledWith("Renderer:T", "e", undefined);
  });

  it("drops a payload with an invalid level and emits a LogIPC warn", () => {
    registerLogHandlers();
    const listener = getSendListener(IPC_CHANNELS.LOG_WRITE);

    listener(ALLOWED_FILE, {
      level: "fatal",
      tag: "Anything",
      message: "should not pass",
    });

    expect(loggerMock.debug).not.toHaveBeenCalled();
    expect(loggerMock.info).not.toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
    // The handler's own diagnostic warn fires on LogIPC.
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "LogIPC",
      "invalid level",
      expect.objectContaining({ level: "fatal" })
    );
  });

  it("drops a payload with a non-string tag or message", () => {
    registerLogHandlers();
    const listener = getSendListener(IPC_CHANNELS.LOG_WRITE);

    listener(ALLOWED_FILE, { level: "info", tag: 123, message: "x" });
    listener(ALLOWED_FILE, { level: "info", tag: "x", message: 456 });

    expect(loggerMock.info).not.toHaveBeenCalled();
  });

  it("REJECTS a disallowed sender origin — logger is never called", () => {
    vi.mocked(isAllowedSender).mockReturnValue(false);
    registerLogHandlers();
    const listener = getSendListener(IPC_CHANNELS.LOG_WRITE);

    listener(DISALLOWED_REMOTE, {
      level: "error",
      tag: "Evil",
      message: "spam",
    });

    expect(loggerMock.debug).not.toHaveBeenCalled();
    expect(loggerMock.info).not.toHaveBeenCalled();
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
  });
});

describe("LOGS_GET_CURRENT_PATH", () => {
  it("returns the path from getCurrentLogPath()", async () => {
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_GET_CURRENT_PATH);
    const result = await handler(ALLOWED_FILE);
    expect(result).toBe(mainLogPath);
  });
});

describe("LOGS_GET_NOISE_PATH", () => {
  it("returns the path from getCurrentNoisePath()", async () => {
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_GET_NOISE_PATH);
    const result = await handler(ALLOWED_FILE);
    expect(result).toBe(noiseLogPath);
  });

  it("returns null when getCurrentNoisePath throws (noise not initialized)", async () => {
    vi.mocked(getCurrentNoisePath).mockImplementation(() => {
      throw new Error("Noise logger is not initialized");
    });
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_GET_NOISE_PATH);
    const result = await handler(ALLOWED_FILE);
    expect(result).toBeNull();
  });
});

describe("LOGS_GET_NETWORK_PATH", () => {
  it("returns the path from getCurrentNetworkPath()", async () => {
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_GET_NETWORK_PATH);
    const result = await handler(ALLOWED_FILE);
    expect(result).toBe(networkLogPath);
  });

  it("returns null when getCurrentNetworkPath throws", async () => {
    vi.mocked(getCurrentNetworkPath).mockImplementation(() => {
      throw new Error("Network logger is not initialized");
    });
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_GET_NETWORK_PATH);
    const result = await handler(ALLOWED_FILE);
    expect(result).toBeNull();
  });
});

describe("LOGS_OPEN_FOLDER", () => {
  it("opens the directory containing the current log file", async () => {
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_OPEN_FOLDER);
    const result = (await handler(ALLOWED_FILE)) as { ok: boolean; error?: string };
    expect(shell.openPath).toHaveBeenCalledWith(tmpDir);
    expect(result).toEqual({ ok: true });
  });

  it("returns {ok:false,error} when shell.openPath reports a failure string", async () => {
    vi.mocked(shell.openPath).mockResolvedValue("Failed to open file: ENOENT");
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_OPEN_FOLDER);
    const result = (await handler(ALLOWED_FILE)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Failed to open file: ENOENT");
  });

  it("returns {ok:false,error} when shell.openPath throws", async () => {
    vi.mocked(shell.openPath).mockRejectedValue(new Error("boom"));
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_OPEN_FOLDER);
    const result = (await handler(ALLOWED_FILE)) as { ok: boolean; error?: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});

describe("LOGS_TAIL", () => {
  it("returns the last N non-empty lines of the main log file", async () => {
    const content = ["a", "b", "c", "d", "e"].join("\n");
    await fs.writeFile(mainLogPath, content);

    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_TAIL);

    const result = (await handler(ALLOWED_FILE, { lines: 3, file: "main" })) as string[];
    expect(result).toEqual(["c", "d", "e"]);
  });

  it("returns the last N lines of the noise file when file='noise'", async () => {
    const content = ["x", "y", "z"].join("\n");
    await fs.writeFile(noiseLogPath, content);

    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_TAIL);

    const result = (await handler(ALLOWED_FILE, { lines: 2, file: "noise" })) as string[];
    expect(result).toEqual(["y", "z"]);
  });

  it("returns the last N lines of the network file when file='network'", async () => {
    const content = ["network-a", "network-b", "network-c"].join("\n");
    await fs.writeFile(networkLogPath, content);

    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_TAIL);

    const result = (await handler(ALLOWED_FILE, { lines: 2, file: "network" })) as string[];
    expect(result).toEqual(["network-b", "network-c"]);
  });

  it("strips trailing empty lines", async () => {
    await fs.writeFile(mainLogPath, "one\ntwo\n\n\n");
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_TAIL);

    const result = (await handler(ALLOWED_FILE, { lines: 5, file: "main" })) as string[];
    expect(result).toEqual(["one", "two"]);
  });

  it("clamps lines to the [1, 5000] range", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 6000; i++) lines.push(`line-${i}`);
    await fs.writeFile(mainLogPath, lines.join("\n"));

    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_TAIL);

    const tooBig = (await handler(ALLOWED_FILE, { lines: 99999, file: "main" })) as string[];
    expect(tooBig.length).toBe(5000);

    const tooSmall = (await handler(ALLOWED_FILE, { lines: 0, file: "main" })) as string[];
    expect(tooSmall.length).toBe(1);

    const negative = (await handler(ALLOWED_FILE, { lines: -7, file: "main" })) as string[];
    expect(negative.length).toBe(1);
  });

  it("returns [] when the requested file does not exist", async () => {
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_TAIL);

    const result = (await handler(ALLOWED_FILE, { lines: 10, file: "main" })) as string[];
    expect(result).toEqual([]);
  });

  it("returns [] for file='noise' when the noise logger is not initialized", async () => {
    vi.mocked(getCurrentNoisePath).mockImplementation(() => {
      throw new Error("Noise logger is not initialized");
    });
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_TAIL);

    const result = (await handler(ALLOWED_FILE, { lines: 10, file: "noise" })) as string[];
    expect(result).toEqual([]);
  });

  it("returns [] for file='network' when the network logger is not initialized", async () => {
    vi.mocked(getCurrentNetworkPath).mockImplementation(() => {
      throw new Error("Network logger is not initialized");
    });
    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_TAIL);

    const result = (await handler(ALLOWED_FILE, { lines: 10, file: "network" })) as string[];
    expect(result).toEqual([]);
  });

  it("filters by full-line query before slicing the tail", async () => {
    const content = [
      "[2026-06-08T20:00:00.000Z] [info] [Main] startup",
      "[2026-06-08T20:00:01.000Z] [warn] [Chromium] turn_port allocate error",
      "[2026-06-08T20:00:02.000Z] [info] [Main] filler-1",
      "[2026-06-08T20:00:03.000Z] [info] [Main] filler-2",
      "[2026-06-08T20:00:04.000Z] [info] [Main] filler-3",
    ].join("\n");
    await fs.writeFile(mainLogPath, content);

    registerLogHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.LOGS_TAIL);

    const result = (await handler(ALLOWED_FILE, {
      lines: 1,
      file: "main",
      query: ["turn_port", "websocket"],
    })) as string[];
    expect(result).toEqual([
      "[2026-06-08T20:00:01.000Z] [warn] [Chromium] turn_port allocate error",
    ]);
  });
});
