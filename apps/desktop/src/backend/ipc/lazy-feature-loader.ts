import { preferencesRepository } from "@backend/features/settings/data/preferences-repository";
import { getBugReportsDir } from "@backend/logging/log-paths";
import { logger } from "@backend/logging/logger";
import { registerLoadedFeatureCleanup } from "@backend/startup/loaded-feature-cleanup";
import { featureLoaderIpcContract } from "@shared/feature-loader-contract";
import { IPC_CHANNELS, IPC_FEATURES, type IpcFeature } from "@shared/ipc-channels";
import { runFeatureRegistrationTransaction } from "./feature-registration-transaction";
import type { MainRendererPort } from "./main-renderer-port";
import type { TrustedIpcRegistry } from "./trusted-ipc-registry";

interface FeatureContext {
  renderer: MainRendererPort;
  registry: TrustedIpcRegistry;
}

type FeatureLoader = (context: FeatureContext) => Promise<void>;

async function ensureConfiguredProxy(context: FeatureContext): Promise<void> {
  if (preferencesRepository.getPreferences().proxy.enabled) {
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
      import("../features/playback/routes/adblock-routes"),
      ensurePlaybackFeature(context),
    ]);
    registerAdBlockHandlers();
  },
  [IPC_FEATURES.APP]: async () => {
    const { registerAppHandlers } = await import("../features/shell/routes/app-routes");
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
      { twitchAccountReader },
      { kickAccountReader },
    ] = await Promise.all([
      import("electron"),
      import("../features/authentication/routes/auth-routes"),
      import("../features/authentication/adapters/electron/auth-window"),
      import("../features/authentication/adapters/kick/kick-auth"),
      import("../features/authentication/adapters/twitch/twitch-auth"),
      import("../features/authentication/adapters/kick/kick-follow-write-service"),
      import("../features/authentication/routes/follow-routes"),
      import("@backend/features/authentication/composition/twitch-account-reader"),
      import("@backend/features/authentication/composition/kick-account-reader"),
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
      followReaders: { twitch: twitchAccountReader, kick: kickAccountReader },
    });
  },
  [IPC_FEATURES.BUG_REPORTS]: async () => {
    const { registerBugReportHandlers } =
      await import("../features/settings/routes/bug-report-routes");
    registerBugReportHandlers(getBugReportsDir());
  },
  [IPC_FEATURES.CATEGORIES]: async (context) => {
    await ensureConfiguredProxy(context);
    const [{ registerCategoryHandlers }, { twitchDiscovery }, { kickDiscovery }] =
      await Promise.all([
        import("../features/discovery/routes/category-routes"),
        import("@backend/features/discovery/composition/twitch-discovery"),
        import("@backend/features/discovery/composition/kick-discovery"),
      ]);
    registerCategoryHandlers({ readers: { twitch: twitchDiscovery, kick: kickDiscovery } });
  },
  [IPC_FEATURES.CHANNELS]: async (context) => {
    await ensureConfiguredProxy(context);
    const [{ registerChannelHandlers }, { twitchDiscovery }, { kickDiscovery }] = await Promise.all(
      [
        import("../features/discovery/routes/channel-routes"),
        import("@backend/features/discovery/composition/twitch-discovery"),
        import("@backend/features/discovery/composition/kick-discovery"),
      ]
    );
    const { twitchAccountReader } =
      await import("@backend/features/authentication/composition/twitch-account-reader");
    registerChannelHandlers({
      twitchFollows: twitchAccountReader,
      readers: { twitch: twitchDiscovery, kick: kickDiscovery },
    });
  },
  [IPC_FEATURES.CHAT]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerChatHandlers } = await import("../features/chat/routes/chat-routes");
    registerChatHandlers();
  },
  [IPC_FEATURES.CHAT_ELIGIBILITY]: async () => {
    const { registerChatEligibilityHandlers } =
      await import("../features/chat/routes/chat-eligibility-routes");
    registerChatEligibilityHandlers();
  },
  [IPC_FEATURES.CHAT_REPLAY]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerChatReplayHandlers } =
      await import("../features/playback/routes/chat-replay-routes");
    registerChatReplayHandlers();
  },
  [IPC_FEATURES.CONNECTIVITY]: async () => {
    const { registerConnectivityHandlers } =
      await import("../features/shell/routes/connectivity-routes");
    registerConnectivityHandlers();
  },
  [IPC_FEATURES.DIAGNOSTICS]: async ({ renderer, registry }) => {
    const { registerDiagnosticsHandlers } =
      await import("../features/settings/routes/diagnostics-routes");
    registerDiagnosticsHandlers(renderer, registry);
  },
  [IPC_FEATURES.DOWNLOADS]: async ({ renderer }) => {
    const { registerDownloadHandlers } =
      await import("../features/media-library/routes/download-routes");
    registerDownloadHandlers(renderer);
  },
  [IPC_FEATURES.EMOTES]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerEmoteHandlers } = await import("../features/chat/routes/emote-routes");
    registerEmoteHandlers(context.registry);
  },
  [IPC_FEATURES.KICK_CHAT]: async (context) => {
    await ensureConfiguredProxy(context);
    const [{ registerKickChatHandlers }, { disposeSendWindow }] = await Promise.all([
      import("../features/chat/routes/kick-chat-routes"),
      import("../features/chat/adapters/kick/kick-send-window"),
    ]);
    registerKickChatHandlers();
    registerLoadedFeatureCleanup("kick-send-window", disposeSendWindow);
  },
  [IPC_FEATURES.LOCAL_CAPTIONS]: async ({ renderer }) => {
    const [
      { registerLocalCaptionHandlers },
      { disposeLocalCaptionRuntime, getLocalCaptionRuntime },
    ] = await Promise.all([
      import("../features/playback/routes/local-caption-routes"),
      import("../features/playback/composition/local-caption-runtime"),
    ]);
    const runtime = getLocalCaptionRuntime(renderer);
    registerLoadedFeatureCleanup("local-captions:runtime", disposeLocalCaptionRuntime);
    registerLocalCaptionHandlers(renderer, runtime);
  },
  [IPC_FEATURES.LOGS]: async () => {
    const { registerLogHandlers } = await import("../features/settings/routes/log-routes");
    registerLogHandlers();
  },
  [IPC_FEATURES.MOD_LOG]: async () => {
    const { registerModLogHandlers } = await import("../features/moderation/routes/modlog-routes");
    registerModLogHandlers();
  },
  [IPC_FEATURES.NOTIFICATIONS]: async ({ renderer }) => {
    const { liveNotificationService } =
      await import("../features/authentication/adapters/electron/live-notification-service");
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
      await import("../features/settings/routes/proxy-routes");
    await applyPersistedProxyOnStart();
    registerProxyHandlers();
  },
  [IPC_FEATURES.SEARCH]: async (context) => {
    await ensureConfiguredProxy(context);
    const [{ registerSearchHandlers }, { twitchDiscovery }, { kickDiscovery }] = await Promise.all([
      import("../features/discovery/routes/search-routes"),
      import("@backend/features/discovery/composition/twitch-discovery"),
      import("@backend/features/discovery/composition/kick-discovery"),
    ]);
    const [{ twitchPlayback }, { kickPlayback }] = await Promise.all([
      import("@backend/features/playback/composition/twitch-playback"),
      import("@backend/features/playback/composition/kick-playback"),
    ]);
    registerSearchHandlers({
      contentReaders: { twitch: twitchPlayback, kick: kickPlayback },
      readers: { twitch: twitchDiscovery, kick: kickDiscovery },
    });
  },
  [IPC_FEATURES.SLOTS]: async (context) => {
    const { renderer } = context;
    const [{ registerSlotControllerHandlers }, { setUseWebContentsViews }] = await Promise.all([
      import("../features/multistream/routes/slot-controller-routes"),
      import("../features/multistream/adapters/electron/slot-controller"),
      ensurePlaybackFeature(context),
    ]);
    if (process.env.STREAMFUSION_WEBCONTENTS_VIEW_SLOTS === "1") {
      setUseWebContentsViews(true);
    }
    registerSlotControllerHandlers(renderer);
  },
  [IPC_FEATURES.STREAM_RECORDING]: async ({ renderer }) => {
    const { registerStreamRecordingHandlers } =
      await import("../features/media-library/routes/stream-recording-routes");
    registerStreamRecordingHandlers(renderer);
  },
  [IPC_FEATURES.STREAMS]: async (context) => {
    await ensureConfiguredProxy(context);
    const [
      { registerStreamHandlers },
      { startKickFollowMetadataRefresh, stopKickFollowMetadataRefresh },
      { twitchDiscovery },
      { kickDiscovery },
    ] = await Promise.all([
      import("../features/discovery/routes/stream-routes"),
      import("../features/authentication/adapters/kick/kick-follow-metadata-refresh"),
      import("@backend/features/discovery/composition/twitch-discovery"),
      import("@backend/features/discovery/composition/kick-discovery"),
    ]);
    startKickFollowMetadataRefresh();
    registerLoadedFeatureCleanup("kick-follow-metadata", stopKickFollowMetadataRefresh);
    registerStreamHandlers({
      readers: { twitch: twitchDiscovery, kick: kickDiscovery },
      followedReaders: { twitch: twitchDiscovery, kick: kickDiscovery },
      categoryReaders: { twitch: twitchDiscovery, kick: kickDiscovery },
    });
  },
  [IPC_FEATURES.STORAGE]: async ({ renderer }) => {
    const [{ registerStorageHandlers }, { registerPreferenceRoutes }, { registerFollowRoutes }] =
      await Promise.all([
        import("./handlers/storage-handlers"),
        import("../features/settings/routes/preferences-routes"),
        import("../features/authentication/routes/follow-routes"),
      ]);
    registerStorageHandlers();
    registerPreferenceRoutes();
    registerFollowRoutes(renderer);
  },
  [IPC_FEATURES.SYSTEM]: async ({ renderer }) => {
    const { registerSystemHandlers } = await import("../features/shell/routes/system-routes");
    registerSystemHandlers(renderer);
  },
  [IPC_FEATURES.TIMEOUT_MODERATION]: async () => {
    const { registerTimeoutModerationHandlers } =
      await import("../features/moderation/routes/timeout-routes");
    registerTimeoutModerationHandlers();
  },
  [IPC_FEATURES.TOKEN_STATUS]: async () => {
    const { registerTokenStatusHandlers } =
      await import("../features/authentication/routes/token-status-routes");
    registerTokenStatusHandlers();
  },
  [IPC_FEATURES.TWITCH_API]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerTwitchApiRoutes } = await import("../features/chat/routes/twitch-api-routes");
    registerTwitchApiRoutes({ renderer: context.renderer });
  },
  [IPC_FEATURES.UPDATES]: async ({ renderer }) => {
    const { registerUpdateHandlers } = await import("../features/settings/routes/update-routes");
    registerUpdateHandlers(renderer);
  },
  [IPC_FEATURES.USER_PROFILE]: async (context) => {
    await ensureConfiguredProxy(context);
    const { registerUserProfileHandlers } =
      await import("../features/discovery/routes/user-profile-routes");
    registerUserProfileHandlers(context.registry);
  },
  [IPC_FEATURES.VIDEOS]: async (context) => {
    await ensureConfiguredProxy(context);
    const [{ registerVideoHandlers }, { twitchPlayback }, { kickPlayback }] = await Promise.all([
      import("../features/playback/routes/video-routes"),
      import("@backend/features/playback/composition/twitch-playback"),
      import("@backend/features/playback/composition/kick-playback"),
    ]);
    registerVideoHandlers({ readers: { twitch: twitchPlayback, kick: kickPlayback } });
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
