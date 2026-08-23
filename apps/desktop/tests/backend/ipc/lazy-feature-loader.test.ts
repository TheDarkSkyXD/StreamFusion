import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const registerCategoryHandlers = vi.hoisted(() => vi.fn());
const registerConnectivityHandlers = vi.hoisted(() => vi.fn());

vi.mock("@/backend/logging/log-paths", () => ({ getBugReportsDir: () => "bug-reports" }));
vi.mock("@/backend/logging/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@/backend/services/storage-service", () => ({
  storageService: { getPreferences: () => ({ proxy: { enabled: false } }) },
}));
vi.mock("@/backend/ipc/handlers/category-handlers", () => ({ registerCategoryHandlers }));
vi.mock("@/backend/ipc/handlers/connectivity-handlers", () => ({
  registerConnectivityHandlers,
}));

import { isIpcFeature, loadIpcFeature } from "@/backend/ipc/lazy-feature-loader";
import { IPC_FEATURES } from "@/shared/ipc-channels";

const featureContext = {
  mainWindow: {} as BrowserWindow,
  registry: {} as never,
};

// Guards: main imports and registers a feature handler only after that feature is requested.
// Guards: repeated requests do not register duplicate handlers, including after a failed load.
// Guards: unknown feature names fail validation before they can select an implementation import.
describe("lazy IPC feature loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a requested feature once", async () => {
    await loadIpcFeature(IPC_FEATURES.CATEGORIES, featureContext);
    await loadIpcFeature(IPC_FEATURES.CATEGORIES, featureContext);
    expect(registerCategoryHandlers).toHaveBeenCalledOnce();
  });

  it("caches a failed load so retry cannot duplicate partial registration", async () => {
    registerConnectivityHandlers.mockImplementationOnce(() => {
      throw new Error("registration failed");
    });

    await expect(loadIpcFeature(IPC_FEATURES.CONNECTIVITY, featureContext)).rejects.toThrow(
      "registration failed"
    );
    await expect(loadIpcFeature(IPC_FEATURES.CONNECTIVITY, featureContext)).rejects.toThrow(
      "registration failed"
    );
    expect(registerConnectivityHandlers).toHaveBeenCalledOnce();
  });

  it("rejects unknown feature names", () => {
    expect(isIpcFeature("not-a-feature")).toBe(false);
  });
});
