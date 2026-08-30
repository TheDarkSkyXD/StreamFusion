import { EventEmitter } from "node:events";

import type { BrowserWindow, WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";

const disposeLocalCaptionRuntime = vi.hoisted(() => vi.fn());
const ensurePlaybackRuntime = vi.hoisted(() => vi.fn());
const getLocalCaptionRuntime = vi.hoisted(() => vi.fn(() => ({ modelStore: {}, supervisor: {} })));
const registerAdBlockHandlers = vi.hoisted(() => vi.fn());
const registerCategoryHandlers = vi.hoisted(() => vi.fn());
const registerConnectivityHandlers = vi.hoisted(() => vi.fn());
const registerDownloadHandlers = vi.hoisted(() => vi.fn());
const registerLocalCaptionHandlers = vi.hoisted(() => vi.fn());

vi.mock("@backend/logging/log-paths", () => ({ getBugReportsDir: () => "bug-reports" }));
vi.mock("@backend/logging/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@backend/services/storage-service", () => ({
  storageService: { getPreferences: () => ({ proxy: { enabled: false } }) },
}));
vi.mock("@backend/startup/playback-runtime", () => ({ ensurePlaybackRuntime }));
vi.mock("@backend/services/captions/local-caption-runtime", () => ({
  disposeLocalCaptionRuntime,
  getLocalCaptionRuntime,
}));
vi.mock("@backend/ipc/handlers/adblock-handlers", () => ({ registerAdBlockHandlers }));
vi.mock("@backend/ipc/handlers/category-handlers", () => ({ registerCategoryHandlers }));
vi.mock("@backend/ipc/handlers/connectivity-handlers", () => ({
  registerConnectivityHandlers,
}));
vi.mock("@backend/ipc/handlers/download-handlers", () => ({ registerDownloadHandlers }));
vi.mock("@backend/ipc/handlers/local-caption-handlers", () => ({
  registerLocalCaptionHandlers,
}));

import { isIpcFeature, loadIpcFeature } from "@backend/ipc/lazy-feature-loader";
import { registerFeatureRollback } from "@backend/ipc/feature-registration-transaction";
import { runLoadedFeatureCleanups } from "@backend/startup/loaded-feature-cleanup";
import { IPC_FEATURES } from "@shared/ipc-channels";
import { createMainRendererPortMock } from "../../helpers/main-renderer-port-mock";

const featureContext = {
  renderer: {} as MainRendererPort,
  registry: {} as never,
};

function createWindow(): BrowserWindow {
  const webContents = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    isCrashed: () => false,
    mainFrame: { isDestroyed: () => false, detached: false },
    send: vi.fn(),
  }) as unknown as WebContents;

  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents,
  }) as unknown as BrowserWindow;
}

// Guards: main imports and registers a feature handler only after that feature is requested.
// Guards: repeated successful requests do not register duplicate handlers.
// Guards: every feature retries after a transient registration failure instead of remaining poisoned.
// Guards: unknown feature names fail validation before they can select an implementation import.
describe("lazy IPC feature loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await runLoadedFeatureCleanups();
  });

  it("loads a requested feature once", async () => {
    await loadIpcFeature(IPC_FEATURES.CATEGORIES, featureContext);
    await loadIpcFeature(IPC_FEATURES.CATEGORIES, featureContext);
    expect(registerCategoryHandlers).toHaveBeenCalledOnce();
  });

  it("retries Downloads after a failed registration", async () => {
    registerDownloadHandlers.mockImplementationOnce(() => {
      throw new Error("registration failed");
    });

    await expect(loadIpcFeature(IPC_FEATURES.DOWNLOADS, featureContext)).rejects.toThrow(
      "registration failed"
    );
    await expect(loadIpcFeature(IPC_FEATURES.DOWNLOADS, featureContext)).resolves.toBeUndefined();
    expect(registerDownloadHandlers).toHaveBeenCalledTimes(2);
  });

  it("retries every feature after a transient registration failure", async () => {
    const rollback = vi.fn();
    registerConnectivityHandlers.mockImplementationOnce(() => {
      registerFeatureRollback(rollback);
      throw new Error("registration failed");
    });

    await expect(loadIpcFeature(IPC_FEATURES.CONNECTIVITY, featureContext)).rejects.toThrow(
      "registration failed"
    );
    await expect(
      loadIpcFeature(IPC_FEATURES.CONNECTIVITY, featureContext)
    ).resolves.toBeUndefined();
    expect(rollback).toHaveBeenCalledOnce();
    expect(registerConnectivityHandlers).toHaveBeenCalledTimes(2);
  });

  it("retains the successful playback dependency when adblock registration retries", async () => {
    const cleanup = vi.fn();
    const renderer = createMainRendererPortMock(createWindow());
    ensurePlaybackRuntime.mockImplementationOnce(async (port: MainRendererPort) => {
      port.useWindow("playback:test", () => cleanup);
    });
    registerAdBlockHandlers.mockImplementationOnce(() => {
      throw new Error("registration failed");
    });

    await expect(
      loadIpcFeature(IPC_FEATURES.ADBLOCK, { ...featureContext, renderer })
    ).rejects.toThrow("registration failed");
    await expect(
      loadIpcFeature(IPC_FEATURES.ADBLOCK, { ...featureContext, renderer })
    ).resolves.toBeUndefined();

    expect(ensurePlaybackRuntime).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    expect(registerAdBlockHandlers).toHaveBeenCalledTimes(2);
  });

  it("disposes a caption runtime after failed registration and at shutdown", async () => {
    registerLocalCaptionHandlers.mockImplementationOnce(() => {
      throw new Error("registration failed");
    });

    await expect(loadIpcFeature(IPC_FEATURES.LOCAL_CAPTIONS, featureContext)).rejects.toThrow(
      "registration failed"
    );
    expect(disposeLocalCaptionRuntime).toHaveBeenCalledOnce();

    await expect(
      loadIpcFeature(IPC_FEATURES.LOCAL_CAPTIONS, featureContext)
    ).resolves.toBeUndefined();
    await runLoadedFeatureCleanups();
    expect(disposeLocalCaptionRuntime).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown feature names", () => {
    expect(isIpcFeature("not-a-feature")).toBe(false);
  });
});
