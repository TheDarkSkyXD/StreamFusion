import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registrars = vi.hoisted(() => ({
  app: vi.fn(),
  lazyFeatures: vi.fn(),
  logs: vi.fn(),
  storage: vi.fn(),
  system: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@backend/logging/logger", () => ({ logger: loggerMock }));
vi.mock("electron", () => ({ app: { isPackaged: true } }));
vi.mock("@backend/ipc/handlers/app-handlers", () => ({
  registerAppHandlers: registrars.app,
}));
vi.mock("@backend/ipc/handlers/log-handlers", () => ({
  registerLogHandlers: registrars.logs,
}));
vi.mock("@backend/ipc/handlers/storage-handlers", () => ({
  registerStorageHandlers: registrars.storage,
}));
vi.mock("@backend/ipc/handlers/system-handlers", () => ({
  registerSystemHandlers: registrars.system,
}));
vi.mock("@backend/ipc/lazy-feature-loader", () => ({
  registerLazyIpcFeatureLoader: registrars.lazyFeatures,
}));

import { registerIpcHandlers } from "@backend/ipc-handlers";
import { TrustedIpcRegistry } from "@backend/ipc/trusted-ipc-registry";

// Guards: startup registers only the feature-loader transport, leaving every handler implementation unloaded.
// Guards: lazy feature handlers receive the trusted registry that validates renderer requests.
// Guards: a broken feature-loader registrar is reported without crashing bootstrap.
describe("registerIpcHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers only the lazy feature entry point", () => {
    const mainWindow = {} as BrowserWindow;
    registerIpcHandlers(mainWindow);

    expect(registrars.system).not.toHaveBeenCalled();
    expect(registrars.app).not.toHaveBeenCalled();
    expect(registrars.storage).not.toHaveBeenCalled();
    expect(registrars.logs).not.toHaveBeenCalled();
    expect(registrars.lazyFeatures).toHaveBeenCalledWith(
      mainWindow,
      expect.any(TrustedIpcRegistry)
    );
  });

  it("logs a feature-loader registrar failure", () => {
    registrars.lazyFeatures.mockImplementation(() => {
      throw new Error("feature loader unavailable");
    });

    expect(() => registerIpcHandlers({} as BrowserWindow)).not.toThrow();
    expect(loggerMock.error).toHaveBeenCalledWith(
      "IPC:Bootstrap",
      "Failed to register IPC handler group",
      expect.objectContaining({
        group: "feature-loader",
        error: expect.objectContaining({ message: "feature loader unavailable" }),
      })
    );
  });
});
