import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@/shared/ipc-channels";

// Mock electron BEFORE importing the handler so its imports resolve to our
// fake ipcMain (matching the pattern used by log-handlers.test.ts).
vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  app: {
    isPackaged: false,
    getVersion: vi.fn(() => "1.0.0-beta.1"),
  },
}));

import { app, ipcMain } from "electron";

import { registerAppHandlers } from "@/backend/ipc/handlers/app-handlers";

type InvokeHandler = (event: unknown, args?: unknown) => unknown;

function getInvokeHandler(channel: string): InvokeHandler {
  const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, InvokeHandler]>;
  const call = calls.find(([c]) => c === channel);
  if (!call) throw new Error(`invoke handler not registered: ${channel}`);
  return call[1];
}

const ALLOWED_FILE = { senderFrame: { url: "file:///C:/app/out/renderer/index.html" } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(app.getVersion).mockReturnValue("1.0.0-beta.1");
  // Re-apply the default for isPackaged on every test (vi.clearAllMocks does
  // NOT reset non-function fields on a mocked module).
  Object.defineProperty(app, "isPackaged", { value: false, configurable: true });
  Object.defineProperty(process.versions, "electron", { value: "35.7.5", configurable: true });
  Object.defineProperty(process.versions, "node", { value: "20.19.0", configurable: true });
});

describe("registerAppHandlers", () => {
  it("registers an invoke handler for APP_GET_ENVIRONMENT", () => {
    registerAppHandlers();
    const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(channels).toContain(IPC_CHANNELS.APP_GET_ENVIRONMENT);
  });
});

describe("APP_GET_ENVIRONMENT", () => {
  it("returns a fully-populated AppEnvironment object", async () => {
    registerAppHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.APP_GET_ENVIRONMENT);
    const result = (await handler(ALLOWED_FILE)) as {
      isDev: boolean;
      platform: NodeJS.Platform;
      appVersion: string;
      electronVersion: string;
      nodeVersion: string;
    };

    expect(result.isDev).toBe(true);
    expect(result.platform).toBe(process.platform);
    expect(result.appVersion).toBe("1.0.0-beta.1");
    expect(result.electronVersion).toBe("35.7.5");
    expect(result.nodeVersion).toBe("20.19.0");
  });

  it("reports isDev=false when the app is packaged", async () => {
    Object.defineProperty(app, "isPackaged", { value: true, configurable: true });
    registerAppHandlers();
    const handler = getInvokeHandler(IPC_CHANNELS.APP_GET_ENVIRONMENT);
    const result = (await handler(ALLOWED_FILE)) as { isDev: boolean };
    expect(result.isDev).toBe(false);
  });
});
