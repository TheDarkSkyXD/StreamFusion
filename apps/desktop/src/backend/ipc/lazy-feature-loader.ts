import type { BrowserWindow } from "electron";

import { getBugReportsDir } from "@/backend/logging/log-paths";
import { logger } from "@/backend/logging/logger";
import { registerLoadedFeatureCleanup } from "@/backend/startup/loaded-feature-cleanup";
import { featureLoaderIpcContract } from "@/ipc-contracts/feature-loader-contracts";
import { IPC_CHANNELS, IPC_FEATURES, type IpcFeature } from "@/shared/ipc-channels";
import type { TrustedIpcRegistry } from "./trusted-ipc-registry";

interface FeatureContext {
  mainWindow: BrowserWindow;
  registry: TrustedIpcRegistry;
}

type FeatureLoader = (context: FeatureContext) => Promise<void>;

async function ensureConfiguredProxy(context: FeatureContext): Promise<void> {
  const { storageService } = await import("../services/storage-service");
  if (storageService.getPreferences().proxy.enabled) {
    await loadIpcFeature(IPC_FEATURES.PROXY, context);
  }
}

async function ensurePlaybackFeature(mainWindow: BrowserWindow): Promise<void> {
  const { ensurePlaybackRuntime } = await import("../startup/playback-runtime");
  await ensurePlaybackRuntime(mainWindow);
}

const featureLoaders = {
  [IPC_FEATURES.ADBLOCK]: async ({ mainWindow }) => {
    const [{ registerAdBlockHandlers }] = await Promise.all([
      import("./handlers/adblock-handlers"),
      ensurePlaybackFeature(mainWindow),
    ]);
    registerAdBlockHandlers(mainWindow);
  },
  [IPC_FEATURES.APP]: async () => {
    const { registerAppHandlers } = await import("./handlers/app-handlers");
    registerAppHandlers();
  },
  [IPC_FEATURES.AUTH]: async (context) => {
    const { mainWindow } = context;
    const [
      { powerMonitor },
      { registerAuthHandlers },
      { authWindowManager },
      { kickAuthService },
      { twitchAuthService },
      { kickFollowWriteService },
      { attachKickFollowWriteService },
    ] = await Promise.all([
      import("electron"),
      import("./handlers/auth-handlers"),
      import("../auth/auth-window"),
      import("../auth/kick-auth"),
      import("../auth/twitch-auth"),
      import("../services/kick-follow-write-service"),
      import("./handlers/storage-handlers"),
      ensureConfiguredProxy(context),
    ]);
    attachKickFollowWriteService(kickFollowWriteService);
    kickFollowWriteService.resumePendingWrites();
    twitchAuthService.scheduleProactiveRefresh();
    kickAuthService.scheduleProactiveRefresh();
    const handleSystemResume = (): void => {
      twitchAuthService.onSystemResume();
      kickAuthService.onSystemResume();
    };
    powerMonitor.on("resume", handleSystemResume);
    registerLoadedFeatureCleanup("auth-windows", () => authWindowManager.closeAllAuthWindows());
    registerLoadedFeatureCleanup("auth-resume-listener", () => {
      powerMonitor.removeListener("resume", handleSystemResume);
    });
    registerAuthHandlers(mainWindow);
  },
  [IPC_FEATURES.BUG_REPORTS]: async () => {
    const { registerBugReportHandlers } = await import("./handlers/bug-report-handlers");
    registerBugReportHandlers(getBugReportsDir());
  },
  [IPC_FEATURES.CATEGORIES]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerCategoryHandlers } = await import("./handlers/category-handlers");
    registerCategoryHandlers();
  },
  [IPC_FEATURES.CHANNELS]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerChannelHandlers } = await import("./handlers/channel-handlers");
    registerChannelHandlers();
  },
  [IPC_FEATURES.CHAT]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerChatHandlers } = await import("./handlers/chat-handlers");
    registerChatHandlers();
  },
  [IPC_FEATURES.CHAT_ELIGIBILITY]: async () => {
    const { registerChatEligibilityHandlers } =
      await import("./handlers/chat-eligibility-handlers");
    registerChatEligibilityHandlers();
  },
  [IPC_FEATURES.CHAT_REPLAY]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerChatReplayHandlers } = await import("./handlers/chat-replay-handlers");
    registerChatReplayHandlers();
  },
  [IPC_FEATURES.CONNECTIVITY]: async () => {
    const { registerConnectivityHandlers } = await import("./handlers/connectivity-handlers");
    registerConnectivityHandlers();
  },
  [IPC_FEATURES.DIAGNOSTICS]: async ({ mainWindow, registry }) => {
    const { registerDiagnosticsHandlers } = await import("./handlers/diagnostics-handlers");
    registerDiagnosticsHandlers(mainWindow, registry);
  },
  [IPC_FEATURES.DOWNLOADS]: async ({ mainWindow }) => {
    const { registerDownloadHandlers } = await import("./handlers/download-handlers");
    registerDownloadHandlers(mainWindow);
  },
  [IPC_FEATURES.EMOTES]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerEmoteHandlers } = await import("./handlers/emote-handlers");
    registerEmoteHandlers(context.registry);
  },
  [IPC_FEATURES.KICK_CHAT]: async (context) => {
    await ensureConfiguredProxy(context);
    const [{ registerKickChatHandlers }, { disposeSendWindow }] = await Promise.all([
      import("./handlers/kick-chat-handlers"),
      import("../api/platforms/kick/kick-send-window"),
    ]);
    registerKickChatHandlers();
    registerLoadedFeatureCleanup("kick-send-window", disposeSendWindow);
  },
  [IPC_FEATURES.LOCAL_CAPTIONS]: async ({ mainWindow }) => {
    const [{ registerLocalCaptionHandlers }, { getLocalCaptionRuntime }] = await Promise.all([
      import("./handlers/local-caption-handlers"),
      import("../services/captions/local-caption-runtime"),
    ]);
    registerLocalCaptionHandlers(mainWindow, getLocalCaptionRuntime(mainWindow));
  },
  [IPC_FEATURES.LOGS]: async () => {
    const { registerLogHandlers } = await import("./handlers/log-handlers");
    registerLogHandlers();
  },
  [IPC_FEATURES.MOD_LOG]: async () => {
    const { registerModLogHandlers } = await import("./handlers/modlog-handlers");
    registerModLogHandlers();
  },
  [IPC_FEATURES.NOTIFICATIONS]: async ({ mainWindow }) => {
    const { liveNotificationService } = await import("../services/live-notification-service");
    liveNotificationService.start(mainWindow);
    registerLoadedFeatureCleanup("live-notifications", () => liveNotificationService.stop());
  },
  [IPC_FEATURES.PLAYBACK]: async ({ mainWindow }) => {
    await ensurePlaybackFeature(mainWindow);
  },
  [IPC_FEATURES.PLATFORM_HEALTH]: async ({ mainWindow }) => {
    const [{ registerPlatformHealthHandlers }, { initStatusPagePoller }] = await Promise.all([
      import("./handlers/platform-health-handlers"),
      import("../api/unified/status-page-poller"),
      import("../logging/platform-health-telemetry"),
    ]);
    registerPlatformHealthHandlers(mainWindow);
    initStatusPagePoller();
  },
  [IPC_FEATURES.PROXY]: async () => {
    const { applyPersistedProxyOnStart, registerProxyHandlers } =
      await import("./handlers/proxy-handlers");
    await applyPersistedProxyOnStart();
    registerProxyHandlers();
  },
  [IPC_FEATURES.SEARCH]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerSearchHandlers } = await import("./handlers/search-handlers");
    registerSearchHandlers();
  },
  [IPC_FEATURES.SLOTS]: async ({ mainWindow }) => {
    const [{ registerSlotControllerHandlers }, { setUseWebContentsViews }] = await Promise.all([
      import("./handlers/slot-controller-handlers"),
      import("../api/unified/slot-controller"),
      ensurePlaybackFeature(mainWindow),
    ]);
    if (process.env.STREAMFUSION_WEBCONTENTS_VIEW_SLOTS === "1") {
      setUseWebContentsViews(true);
    }
    registerSlotControllerHandlers(mainWindow);
  },
  [IPC_FEATURES.STREAM_RECORDING]: async ({ mainWindow }) => {
    const { registerStreamRecordingHandlers } =
      await import("./handlers/stream-recording-handlers");
    registerStreamRecordingHandlers(mainWindow);
  },
  [IPC_FEATURES.STREAMS]: async (context) => {
    const { mainWindow } = context;
    await ensureConfiguredProxy(context);
    const [
      { registerStreamHandlers },
      { startKickFollowMetadataRefresh, stopKickFollowMetadataRefresh },
    ] = await Promise.all([
      import("./handlers/stream-handlers"),
      import("../services/kick-follow-metadata-refresh"),
    ]);
    startKickFollowMetadataRefresh();
    registerLoadedFeatureCleanup("kick-follow-metadata", stopKickFollowMetadataRefresh);
    registerStreamHandlers();
  },
  [IPC_FEATURES.STORAGE]: async ({ mainWindow }) => {
    const { registerStorageHandlers } = await import("./handlers/storage-handlers");
    registerStorageHandlers(mainWindow);
  },
  [IPC_FEATURES.SYSTEM]: async ({ mainWindow }) => {
    const { registerSystemHandlers } = await import("./handlers/system-handlers");
    registerSystemHandlers(mainWindow);
  },
  [IPC_FEATURES.TIMEOUT_MODERATION]: async () => {
    const { registerTimeoutModerationHandlers } =
      await import("./handlers/timeout-moderation-handlers");
    registerTimeoutModerationHandlers();
  },
  [IPC_FEATURES.TOKEN_STATUS]: async () => {
    const { registerTokenStatusHandlers } = await import("./handlers/token-status-handlers");
    registerTokenStatusHandlers();
  },
  [IPC_FEATURES.TWITCH_API]: async (context) => {
    const { mainWindow } = context;
    await ensureConfiguredProxy(context);
    const { registerTwitchApiHandlers } = await import("./handlers/twitch-api-handlers");
    registerTwitchApiHandlers({ mainWindow });
  },
  [IPC_FEATURES.UPDATES]: async ({ mainWindow }) => {
    const { registerUpdateHandlers } = await import("./handlers/update-handlers");
    registerUpdateHandlers(mainWindow);
  },
  [IPC_FEATURES.USER_PROFILE]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerUserProfileHandlers } = await import("./handlers/user-profile-handlers");
    registerUserProfileHandlers(context.registry);
  },
  [IPC_FEATURES.VIDEOS]: async (context) => {
    const { mainWindow } = context;
    await ensureConfiguredProxy(context);
    const { registerVideoHandlers } = await import("./handlers/video-handlers");
    registerVideoHandlers();
  },
} satisfies Record<IpcFeature, FeatureLoader>;

const pendingFeatures = new Map<IpcFeature, Promise<void>>();

export function isIpcFeature(value: unknown): value is IpcFeature {
  return Object.values(IPC_FEATURES).some((feature) => feature === value);
}

export function loadIpcFeature(feature: IpcFeature, context: FeatureContext): Promise<void> {
  let pending = pendingFeatures.get(feature);
  if (!pending) {
    pending = featureLoaders[feature](context).then(() => {
      logger.info("IPC:Lazy", "Feature handlers loaded", { feature });
    });
    pendingFeatures.set(feature, pending);
  }
  return pending;
}

export function registerLazyIpcFeatureLoader(
  mainWindow: BrowserWindow,
  registry: TrustedIpcRegistry
): void {
  registry.handle({
    channel: IPC_CHANNELS.IPC_FEATURE_LOAD,
    contract: featureLoaderIpcContract,
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async (_event, requestedFeature) => {
      await loadIpcFeature(requestedFeature, { mainWindow, registry });
      return { kind: "ok", value: null } as const;
    },
  });
}
