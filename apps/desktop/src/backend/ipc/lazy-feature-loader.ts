import { getBugReportsDir } from "@backend/logging/log-paths";
import { logger } from "@backend/logging/logger";
import { storageService } from "@backend/services/storage-service";
import { registerLoadedFeatureCleanup } from "@backend/startup/loaded-feature-cleanup";
import { featureLoaderIpcContract } from "@shared/feature-loader-contract";
import { IPC_CHANNELS, IPC_FEATURES, type IpcFeature } from "@shared/ipc-channels";
import type { TrustedIpcRegistry } from "./trusted-ipc-registry";
import type { MainRendererPort } from "./main-renderer-port";
import { runFeatureRegistrationTransaction } from "./feature-registration-transaction";

interface FeatureContext {
  renderer: MainRendererPort;
  registry: TrustedIpcRegistry;
}

type FeatureLoader = (context: FeatureContext) => Promise<void>;

async function ensureConfiguredProxy(context: FeatureContext): Promise<void> {
  if (storageService.getPreferences().proxy.enabled) {
    await loadIpcFeature(IPC_FEATURES.PROXY, context);
  }
}

async function initializePlaybackFeature(renderer: MainRendererPort): Promise<void> {
  const { ensurePlaybackRuntime } = await import("../startup/playback-runtime");
  await ensurePlaybackRuntime(renderer);
}

async function ensurePlaybackFeature(context: FeatureContext): Promise<void> {
  await loadIpcFeature(IPC_FEATURES.PLAYBACK, context);
}

const featureLoaders = {
  [IPC_FEATURES.ADBLOCK]: async (context) => {
    const [{ registerAdBlockHandlers }] = await Promise.all([
      import("./handlers/adblock-handlers"),
      ensurePlaybackFeature(context),
    ]);
    registerAdBlockHandlers();
  },
  [IPC_FEATURES.APP]: async () => {
    const { registerAppHandlers } = await import("./handlers/app-handlers");
    registerAppHandlers();
  },
  [IPC_FEATURES.AUTH]: async (context) => {
    const { renderer } = context;
    const [
      { powerMonitor },
      { registerAuthHandlers },
      { authWindowManager },
      { kickAuthService },
      { twitchAuthService },
      { kickFollowWriteService },
      { attachKickFollowWriteService },
      { twitchClient },
      { kickClient },
    ] = await Promise.all([
      import("electron"),
      import("./handlers/auth-handlers"),
      import("../auth/auth-window"),
      import("../auth/kick-auth"),
      import("../auth/twitch-auth"),
      import("../services/kick-follow-write-service"),
      import("./handlers/storage-handlers"),
      import("../api/platforms/twitch/twitch-client"),
      import("../api/platforms/kick/kick-client"),
      ensureConfiguredProxy(context),
    ]);
    attachKickFollowWriteService(kickFollowWriteService, renderer);
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
    registerAuthHandlers(renderer, {
      followReaders: { twitch: twitchClient, kick: kickClient },
    });
  },
  [IPC_FEATURES.BUG_REPORTS]: async () => {
    const { registerBugReportHandlers } = await import("./handlers/bug-report-handlers");
    registerBugReportHandlers(getBugReportsDir());
  },
  [IPC_FEATURES.CATEGORIES]: async (context) => {
    await ensureConfiguredProxy(context);
    const [{ registerCategoryHandlers }, { twitchClient }, { kickClient }] = await Promise.all([
      import("./handlers/category-handlers"),
      import("../api/platforms/twitch/twitch-client"),
      import("../api/platforms/kick/kick-client"),
    ]);
    registerCategoryHandlers({ readers: { twitch: twitchClient, kick: kickClient } });
  },
  [IPC_FEATURES.CHANNELS]: async (context) => {
    await ensureConfiguredProxy(context);
    const [{ registerChannelHandlers }, { twitchClient }, { kickClient }] = await Promise.all([
      import("./handlers/channel-handlers"),
      import("../api/platforms/twitch/twitch-client"),
      import("../api/platforms/kick/kick-client"),
    ]);
    registerChannelHandlers({ readers: { twitch: twitchClient, kick: kickClient } });
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
  [IPC_FEATURES.DIAGNOSTICS]: async ({ renderer, registry }) => {
    const { registerDiagnosticsHandlers } = await import("./handlers/diagnostics-handlers");
    registerDiagnosticsHandlers(renderer, registry);
  },
  [IPC_FEATURES.DOWNLOADS]: async ({ renderer }) => {
    const { registerDownloadHandlers } = await import("./handlers/download-handlers");
    registerDownloadHandlers(renderer);
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
  [IPC_FEATURES.LOCAL_CAPTIONS]: async ({ renderer }) => {
    const [
      { registerLocalCaptionHandlers },
      { disposeLocalCaptionRuntime, getLocalCaptionRuntime },
    ] = await Promise.all([
      import("./handlers/local-caption-handlers"),
      import("../services/captions/local-caption-runtime"),
    ]);
    const runtime = getLocalCaptionRuntime(renderer);
    registerLoadedFeatureCleanup("local-captions:runtime", disposeLocalCaptionRuntime);
    registerLocalCaptionHandlers(renderer, runtime);
  },
  [IPC_FEATURES.LOGS]: async () => {
    const { registerLogHandlers } = await import("./handlers/log-handlers");
    registerLogHandlers();
  },
  [IPC_FEATURES.MOD_LOG]: async () => {
    const { registerModLogHandlers } = await import("./handlers/modlog-handlers");
    registerModLogHandlers();
  },
  [IPC_FEATURES.NOTIFICATIONS]: async ({ renderer }) => {
    const { liveNotificationService } = await import("../services/live-notification-service");
    liveNotificationService.start(renderer);
    registerLoadedFeatureCleanup("live-notifications", () => liveNotificationService.stop());
  },
  [IPC_FEATURES.PLAYBACK]: async ({ renderer }) => {
    await initializePlaybackFeature(renderer);
  },
  [IPC_FEATURES.PLATFORM_HEALTH]: async ({ renderer }) => {
    const [{ registerPlatformHealthHandlers }, { initStatusPagePoller }] = await Promise.all([
      import("./handlers/platform-health-handlers"),
      import("../api/unified/status-page-poller"),
      import("../logging/platform-health-telemetry"),
    ]);
    registerPlatformHealthHandlers(renderer);
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
    const [{ registerSearchHandlers }, { twitchClient }, { kickClient }] = await Promise.all([
      import("./handlers/search-handlers"),
      import("../api/platforms/twitch/twitch-client"),
      import("../api/platforms/kick/kick-client"),
    ]);
    registerSearchHandlers({ readers: { twitch: twitchClient, kick: kickClient } });
  },
  [IPC_FEATURES.SLOTS]: async (context) => {
    const { renderer } = context;
    const [{ registerSlotControllerHandlers }, { setUseWebContentsViews }] = await Promise.all([
      import("./handlers/slot-controller-handlers"),
      import("../api/unified/slot-controller"),
      ensurePlaybackFeature(context),
    ]);
    if (process.env.STREAMFUSION_WEBCONTENTS_VIEW_SLOTS === "1") {
      setUseWebContentsViews(true);
    }
    registerSlotControllerHandlers(renderer);
  },
  [IPC_FEATURES.STREAM_RECORDING]: async ({ renderer }) => {
    const { registerStreamRecordingHandlers } =
      await import("./handlers/stream-recording-handlers");
    registerStreamRecordingHandlers(renderer);
  },
  [IPC_FEATURES.STREAMS]: async (context) => {
    await ensureConfiguredProxy(context);
    const [
      { registerStreamHandlers },
      { startKickFollowMetadataRefresh, stopKickFollowMetadataRefresh },
      { twitchClient },
      { kickClient },
    ] = await Promise.all([
      import("./handlers/stream-handlers"),
      import("../services/kick-follow-metadata-refresh"),
      import("../api/platforms/twitch/twitch-client"),
      import("../api/platforms/kick/kick-client"),
    ]);
    startKickFollowMetadataRefresh();
    registerLoadedFeatureCleanup("kick-follow-metadata", stopKickFollowMetadataRefresh);
    registerStreamHandlers({
      readers: { twitch: twitchClient, kick: kickClient },
      followedReaders: { twitch: twitchClient, kick: kickClient },
      categoryReaders: { twitch: twitchClient, kick: kickClient },
    });
  },
  [IPC_FEATURES.STORAGE]: async ({ renderer }) => {
    const { registerStorageHandlers } = await import("./handlers/storage-handlers");
    registerStorageHandlers(renderer);
  },
  [IPC_FEATURES.SYSTEM]: async ({ renderer }) => {
    const { registerSystemHandlers } = await import("./handlers/system-handlers");
    registerSystemHandlers(renderer);
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
    await ensureConfiguredProxy(context);
    const { registerTwitchApiHandlers } = await import("./handlers/twitch-api-handlers");
    registerTwitchApiHandlers({ renderer: context.renderer });
  },
  [IPC_FEATURES.UPDATES]: async ({ renderer }) => {
    const { registerUpdateHandlers } = await import("./handlers/update-handlers");
    registerUpdateHandlers(renderer);
  },
  [IPC_FEATURES.USER_PROFILE]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerUserProfileHandlers } = await import("./handlers/user-profile-handlers");
    registerUserProfileHandlers(context.registry);
  },
  [IPC_FEATURES.VIDEOS]: async (context) => {
    await ensureConfiguredProxy(context);
    const [{ registerVideoHandlers }, { twitchClient }, { kickClient }] = await Promise.all([
      import("./handlers/video-handlers"),
      import("../api/platforms/twitch/twitch-client"),
      import("../api/platforms/kick/kick-client"),
    ]);
    registerVideoHandlers({ readers: { twitch: twitchClient, kick: kickClient } });
  },
} satisfies Record<IpcFeature, FeatureLoader>;

const pendingFeatures = new Map<IpcFeature, Promise<void>>();

export function isIpcFeature(value: unknown): value is IpcFeature {
  return Object.values(IPC_FEATURES).some((feature) => feature === value);
}

export function loadIpcFeature(feature: IpcFeature, context: FeatureContext): Promise<void> {
  let pending = pendingFeatures.get(feature);
  if (!pending) {
    pending = runFeatureRegistrationTransaction(() => featureLoaders[feature](context))
      .then(() => {
        logger.info("IPC:Lazy", "Feature handlers loaded", { feature });
      })
      .catch((error: unknown) => {
        if (pendingFeatures.get(feature) === pending) pendingFeatures.delete(feature);
        logger.error("IPC:Lazy", "Feature handler registration failed", {
          feature,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      });
    pendingFeatures.set(feature, pending);
  }
  return pending;
}

export function registerLazyIpcFeatureLoader(
  renderer: MainRendererPort,
  registry: TrustedIpcRegistry
): void {
  registry.handle({
    channel: IPC_CHANNELS.IPC_FEATURE_LOAD,
    contract: featureLoaderIpcContract,
    failureResponse: registry.internalError(),
    createFailureResponse: () => registry.internalError(),
    execute: async (_event, requestedFeature) => {
      await loadIpcFeature(requestedFeature, { renderer, registry });
      return { kind: "ok", value: null } as const;
    },
  });
}
