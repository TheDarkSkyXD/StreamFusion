import { EventEmitter } from "node:events";

import type { MainRendererPort } from "@backend/ipc/main-renderer-port";
import type { BrowserWindow, WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disposeLocalCaptionRuntime = vi.hoisted(() => vi.fn());
const ensurePlaybackRuntime = vi.hoisted(() => vi.fn());
const getLocalCaptionRuntime = vi.hoisted(() => vi.fn(() => ({ modelStore: {}, supervisor: {} })));
const registerAuthHandlers = vi.hoisted(() => vi.fn());
const registerAdBlockHandlers = vi.hoisted(() => vi.fn());
const registerCategoryHandlers = vi.hoisted(() => vi.fn());
const registerConnectivityHandlers = vi.hoisted(() => vi.fn());
const registerDownloadHandlers = vi.hoisted(() => vi.fn());
const registerLocalCaptionHandlers = vi.hoisted(() => vi.fn());
const registerSearchHandlers = vi.hoisted(() => vi.fn());
const registerStreamHandlers = vi.hoisted(() => vi.fn());
const registerVideoHandlers = vi.hoisted(() => vi.fn());
const startKickFollowMetadataRefresh = vi.hoisted(() => vi.fn());
const stopKickFollowMetadataRefresh = vi.hoisted(() => vi.fn());
const attachKickFollowWriteService = vi.hoisted(() => vi.fn());
const resumePendingWrites = vi.hoisted(() => vi.fn());
const scheduleKickRefresh = vi.hoisted(() => vi.fn());
const scheduleTwitchRefresh = vi.hoisted(() => vi.fn());
const powerMonitor = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn() }));
const twitchDiscovery = vi.hoisted(() => ({ platform: "twitch" as const }));
const kickDiscovery = vi.hoisted(() => ({ platform: "kick" as const }));

vi.mock("electron", () => ({ powerMonitor }));
vi.mock("@backend/logging/log-paths", () => ({ getBugReportsDir: () => "bug-reports" }));
vi.mock("@backend/logging/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@backend/services/storage-service", () => ({
  storageService: { getPreferences: () => ({ proxy: { enabled: false } }) },
}));
vi.mock("@backend/features/settings/data/preferences-repository", () => ({
  preferencesRepository: { getPreferences: () => ({ proxy: { enabled: false } }) },
}));
vi.mock("@backend/startup/playback-runtime", () => ({ ensurePlaybackRuntime }));
vi.mock("@backend/features/playback/composition/local-caption-runtime", () => ({
  disposeLocalCaptionRuntime,
  getLocalCaptionRuntime,
}));
vi.mock("@backend/features/authentication/routes/auth-routes", () => ({ registerAuthHandlers }));
vi.mock("@backend/features/authentication/adapters/electron/auth-window", () => ({
  authWindowManager: { closeAllAuthWindows: vi.fn() },
}));
vi.mock("@backend/features/authentication/adapters/kick/kick-auth", () => ({
  kickAuthService: { onSystemResume: vi.fn(), scheduleProactiveRefresh: scheduleKickRefresh },
}));
vi.mock("@backend/features/authentication/adapters/twitch/twitch-auth", () => ({
  twitchAuthService: { onSystemResume: vi.fn(), scheduleProactiveRefresh: scheduleTwitchRefresh },
}));
vi.mock("@backend/features/authentication/adapters/kick/kick-follow-write-service", () => ({
  kickFollowWriteService: { resumePendingWrites },
}));
vi.mock("@backend/features/authentication/routes/follow-routes", () => ({
  attachKickFollowWriteService,
  registerFollowRoutes: vi.fn(),
}));
vi.mock("@backend/features/playback/routes/adblock-routes", () => ({ registerAdBlockHandlers }));
vi.mock("@backend/features/discovery/routes/category-routes", () => ({ registerCategoryHandlers }));
vi.mock("@backend/features/shell/routes/connectivity-routes", () => ({
  registerConnectivityHandlers,
}));
vi.mock("@backend/features/media-library/routes/download-routes", () => ({
  registerDownloadHandlers,
}));
vi.mock("@backend/features/playback/routes/local-caption-routes", () => ({
  registerLocalCaptionHandlers,
}));
vi.mock("@backend/features/discovery/routes/search-routes", () => ({ registerSearchHandlers }));
vi.mock("@backend/features/discovery/routes/stream-routes", () => ({ registerStreamHandlers }));
vi.mock("@backend/features/playback/routes/video-routes", () => ({ registerVideoHandlers }));
vi.mock("@backend/features/authentication/adapters/kick/kick-follow-metadata-refresh", () => ({
  startKickFollowMetadataRefresh,
  stopKickFollowMetadataRefresh,
}));
vi.mock("@backend/features/discovery/composition/twitch-discovery", () => ({
  twitchDiscovery: twitchDiscovery,
}));
vi.mock("@backend/features/authentication/composition/twitch-account-reader", () => ({
  twitchAccountReader: twitchDiscovery,
}));
vi.mock("@backend/features/playback/composition/twitch-playback", () => ({
  twitchPlayback: twitchDiscovery,
}));
vi.mock("@backend/api/platforms/twitch/twitch-transport", () => ({
  twitchTransport: twitchDiscovery,
}));
vi.mock("@backend/features/discovery/composition/kick-discovery", () => ({
  kickDiscovery: kickDiscovery,
}));
vi.mock("@backend/features/authentication/composition/kick-account-reader", () => ({
  kickAccountReader: kickDiscovery,
}));
vi.mock("@backend/features/playback/composition/kick-playback", () => ({
  kickPlayback: kickDiscovery,
}));
vi.mock("@backend/api/platforms/kick/kick-transport", () => ({ kickTransport: kickDiscovery }));

import { registerFeatureRollback } from "@backend/ipc/feature-registration-transaction";
import { isIpcFeature, loadIpcFeature } from "@backend/ipc/lazy-feature-loader";
import { logger } from "@backend/logging/logger";
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
// Guards: registration failures identify the feature and root error in the durable log.
// Guards: unknown feature names fail validation before they can select an implementation import.
// Guards: discovery feature composition injects both concrete Platform adapters explicitly.
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
    expect(registerCategoryHandlers).toHaveBeenCalledWith({
      readers: { twitch: twitchDiscovery, kick: kickDiscovery },
    });
  });

  it("composes the Streams handler with Twitch and Kick readers", async () => {
    await loadIpcFeature(IPC_FEATURES.STREAMS, featureContext);

    expect(registerStreamHandlers).toHaveBeenCalledWith({
      readers: { twitch: twitchDiscovery, kick: kickDiscovery },
      followedReaders: { twitch: twitchDiscovery, kick: kickDiscovery },
      categoryReaders: { twitch: twitchDiscovery, kick: kickDiscovery },
    });
    expect(startKickFollowMetadataRefresh).toHaveBeenCalledOnce();
  });

  it("composes Auth follow sync with Twitch and Kick account readers", async () => {
    await loadIpcFeature(IPC_FEATURES.AUTH, featureContext);

    expect(registerAuthHandlers).toHaveBeenCalledWith(featureContext.renderer, {
      followReaders: { twitch: twitchDiscovery, kick: kickDiscovery },
    });
    expect(attachKickFollowWriteService).toHaveBeenCalledWith(
      expect.anything(),
      featureContext.renderer
    );
  });

  it("composes the Search handler with Twitch and Kick readers", async () => {
    await loadIpcFeature(IPC_FEATURES.SEARCH, featureContext);

    expect(registerSearchHandlers).toHaveBeenCalledWith({
      contentReaders: { twitch: twitchDiscovery, kick: kickDiscovery },
      readers: { twitch: twitchDiscovery, kick: kickDiscovery },
    });
  });

  it("composes the Videos handler with Twitch and Kick readers", async () => {
    await loadIpcFeature(IPC_FEATURES.VIDEOS, featureContext);

    expect(registerVideoHandlers).toHaveBeenCalledWith({
      readers: { twitch: twitchDiscovery, kick: kickDiscovery },
    });
  });

  it("retries Downloads after a failed registration", async () => {
    registerDownloadHandlers.mockImplementationOnce(() => {
      throw new Error("registration failed");
    });

    await expect(loadIpcFeature(IPC_FEATURES.DOWNLOADS, featureContext)).rejects.toThrow(
      "registration failed"
    );
    expect(logger.error).toHaveBeenCalledWith("IPC:Lazy", "Feature handler registration failed", {
      feature: IPC_FEATURES.DOWNLOADS,
      error: "registration failed",
    });
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
