import {
  MultistreamWorkspace,
  type MultistreamWorkspaceProps,
} from "@mobile/features/multistream/components/multistream-workspace";
import {
  ConnectedChatPanel,
  type ConnectedChatRuntime,
} from "@mobile/features/chat/components/connected-chat-panel";
import {
  ModWorkspace,
  type ModerationScopeReturn,
} from "@mobile/features/moderation/components/mod-workspace";
import { EngagementSheet } from "@mobile/features/engagement/components/engagement-sheet";
import type { ChatEngagementInlineRuntime } from "@mobile/features/engagement/components/chat-engagement-inline";
import type { ModerationController } from "@mobile/features/moderation/domain/moderation-controller";
import type { EngagementController } from "@mobile/features/engagement/domain/engagement-controller";
import type { ModerationChannel } from "@mobile/features/moderation/capabilities/moderation";
import type { PlatformWorkflowNavigation } from "@mobile/features/moderation/capabilities/workflow-navigation";
import type { Platform as StreamPlatform } from "@streamfusion/core/platform";
import { ArrowLeft, ChevronRight, CircleUserRound } from "lucide-react-native";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextLayoutEventData,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AppLinkSource } from "@mobile/features/shell/capabilities/app-links";
import type { CapabilityProfileViewModel } from "@mobile/features/capability-profile/components/capability-profile-runtime-controller";
import { InstallationPolicyPanel } from "@mobile/features/installation-policy/components/installation-policy-panel";
import type { InstallationPolicyViewModel } from "@mobile/features/installation-policy/domain/installation-policy-runtime-controller";
import type {
  ActivityRepository,
  ShellRestorationRepository,
} from "@mobile/features/storage/capabilities/persistence";
import { MobileConnectivityBanner } from "@mobile/design/connectivity-banner";
import { MobileSettingsIcon } from "@mobile/design/settings-icon";
import { MobileButton } from "@mobile/design/button";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileListRow } from "@mobile/design/list-row";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { useNetworkStatus } from "@mobile/features/connectivity/components/use-network-status";
import { useActivityController } from "@mobile/features/activity/components/activity-controller";
import { InAppNotificationBannerView } from "@mobile/features/notifications/components/in-app-notification-banner";
import { NotificationProofControl } from "@mobile/features/notifications/components/notification-proof-control";
import type {
  NativeNotificationRuntime,
  NotificationOpenLocation,
} from "@mobile/features/notifications/capabilities/native-notifications";
import { proofLivePayload } from "@mobile/features/notifications/domain/notification-entry";
import { DevelopmentActivityProofControl } from "@mobile/features/activity/components/development-activity-proof-control";
import type { DevelopmentActivityProofViewModel } from "@mobile/features/activity/capabilities/development-activity-proof";
import {
  ActivityDetailScreen,
  ActivityScreen,
} from "@mobile/features/activity/components/activity-screen";
import { DiagnosticsWorkspace } from "@mobile/features/diagnostics/components/diagnostics-workspace";
import type { MobileDiagnosticsTab } from "@mobile/features/diagnostics/capabilities/diagnostics-workspace";
import type { DevelopmentClientViewModel } from "@mobile/features/diagnostics/domain/development-client-controller";
import type { PersistenceViewModel } from "@mobile/features/diagnostics/components/persistence-controller";
import {
  diagnosticsCollectionCopy,
  diagnosticsObservationCopy,
  parseDiagnosticsTab,
} from "@mobile/features/diagnostics/domain/diagnostics-workspace";
import { HistoryScreen } from "@mobile/features/media-library/components/history-screen";
import type { WatchScreenRuntime } from "@mobile/features/watch/components/watch-screen";
import { DownloadsScreen } from "@mobile/features/media-jobs/components/downloads-screen";
import { MediaJobScreen } from "@mobile/features/media-jobs/components/media-job-screen";
import { MediaJobsDiagnosticsPanel } from "@mobile/features/media-jobs/components/media-jobs-diagnostics-panel";
import { useMediaJobsController } from "@mobile/features/media-jobs/components/use-media-jobs-controller";
import type { MediaJobWorkflow } from "@mobile/features/media-jobs/capabilities/media-jobs";
import { LocalCaptionsDiagnosticsHost } from "@mobile/features/local-captions/components/local-captions-diagnostics-panel";
import { useLocalCaptionsController } from "@mobile/features/local-captions/components/use-local-captions-controller";
import type { LocalCaptionsPort } from "@mobile/features/local-captions/capabilities/local-captions";
import { NativeCapabilityStubProofControl } from "@mobile/features/native-contracts/components/native-capability-stub-proof-control";
import { CapabilityProfilePanel } from "@mobile/features/capability-profile/components/capability-profile-panel";
import { DevelopmentResourceFailureProofControl } from "@mobile/features/capability-profile/components/development-resource-failure-proof-control";
import type { RuntimeObservationDevelopmentProofResult } from "@mobile/features/capability-profile/capabilities/capability-profile";
import type { KickAccountActions } from "@mobile/features/auth/components/kick-account-card";
import type { KickAccountSessionSnapshot } from "@mobile/features/auth/domain/kick-account-session-controller";
import {
  TwitchAccountsPanel,
  type TwitchAccountActions,
  type TwitchAccountViewModel,
} from "@mobile/features/auth/components/twitch-accounts-panel";
import type { DiscoveryPreferenceStore } from "@mobile/features/discovery/capabilities/discovery-preferences";
import type {
  DiscoverySession,
  SearchHistoryRepository,
} from "@mobile/features/discovery/capabilities/platform-reads";
import { CategoriesScreen } from "@mobile/features/discovery/components/categories-screen";
import { CategoryDetailScreen } from "@mobile/features/discovery/components/category-detail-screen";
import { ChannelDetailScreen } from "@mobile/features/discovery/components/channel-detail-screen";
import { UnifiedSearchScreen } from "@mobile/features/discovery/components/unified-search-screen";
import type { FollowingSession } from "@mobile/features/follows/capabilities/following-session";
import { FollowingWorkspace } from "@mobile/features/follows/components/following-workspace";
import type { ConnectivitySession } from "@mobile/features/connectivity/capabilities/connectivity-session";
import { ConnectivityDiagnosticsPanel } from "@mobile/features/connectivity/components/connectivity-diagnostics-panel";
import { ProxySettingsPanel } from "@mobile/features/connectivity/components/proxy-settings-panel";
import { AdBlockSettingsWorkspace } from "@mobile/features/ad-blocking/components/adblock-settings-workspace";
import type { PlaylistProxyHealth } from "@mobile/features/ad-blocking/capabilities/playlist-proxy-health";
import type { TwitchPlaylistProxySession } from "@mobile/features/ad-blocking/capabilities/twitch-playlist-proxy";
import type { AdBlockSession } from "@mobile/features/ad-blocking/capabilities/ad-blocking";
import type { ChatDisplaySettingsSession } from "@mobile/features/settings/capabilities/chat-display-settings";
import type { NotificationSettingsSession } from "@mobile/features/settings/capabilities/notification-settings";
import type { PredictionSettingsSession } from "@mobile/features/settings/capabilities/prediction-settings";
import type { SettingsSession } from "@mobile/features/settings/capabilities/settings";
import type { SupportSettingsSession } from "@mobile/features/settings/capabilities/support-settings";
import { ApiTokensSettingsPanel } from "@mobile/features/settings/components/api-tokens-settings-panel";
import { ChatSettingsPanel } from "@mobile/features/settings/components/chat-settings-panel";
import { IntegrationsSettingsPanel } from "@mobile/features/settings/components/integrations-settings-panel";
import { NotificationsSettingsPanel } from "@mobile/features/settings/components/notifications-settings-panel";
import { PredictionsSettingsPanel } from "@mobile/features/settings/components/predictions-settings-panel";
import { SettingsWorkspace } from "@mobile/features/settings/components/settings-workspace";
import {
  AboutSettingsPanel,
  DiagnosticsSettingsPanel,
  LogsSettingsPanel,
  ReportBugSettingsPanel,
  UpdatesSettingsPanel,
  UpdateAvailableNotice,
} from "@mobile/features/settings/components/support-settings-panels";
import { useSettingsSession } from "@mobile/features/settings/components/use-settings-session";
import type { ProductPreferences } from "@streamfusion/core/settings";
import {
  WatchRoute,
  type WatchCaptionSession,
  type WatchDownloadSession,
} from "@mobile/features/watch/components/watch-route";
import { WatchMiniPlayerHost } from "@mobile/features/watch/components/mini-player";
import { useWatchPeek } from "@mobile/features/watch/components/use-focused-watch-session";
import { isPictureInPictureSurface } from "@mobile/features/watch/domain/player-presentation";
import { watchDownloadJobId } from "@mobile/features/watch/domain/watch-download";
import { watchRecordingJobId } from "@mobile/features/watch/domain/watch-recording";
import type {
  WatchPeek,
  WatchTarget,
} from "@mobile/features/watch/capabilities/watch";

import { DestinationIcon, MoreRouteIcon } from "./destination-icon";
import { useKeyboardInset } from "./use-keyboard-inset";
import { resolveHardwareBack } from "../domain/hardware-back";
import { safeFrameBottomInset } from "../domain/keyboard-overlay-inset";
import {
  applyCompactNavigationTextMeasurement,
  type CompactNavigationLayout,
} from "../domain/shell-layout";
import {
  bottomNavigationSafeInset,
  canNavigateBack,
  getActiveShellLocation,
  getActiveShellRoute,
  getShellNavigationPlacement,
  MORE_ROUTE_IDS,
  resolveShellHeaderCopy,
  SHELL_DESTINATIONS,
  SHELL_ROUTES,
  type ShellDestination,
  type ShellLocation,
  type ShellNavigationAction,
  type ShellNavigationState,
} from "../domain/shell-navigation";
import {
  locationTargetFromWatch,
  watchTargetFromLocation,
} from "../domain/shell-watch-target";
import {
  useShellLifecycleController,
  type ShellLifecycleStatus,
} from "./shell-lifecycle-controller";

const previewRoutes: Readonly<
  Partial<Record<ShellDestination["id"], ShellLocation>>
> = {
  watch: { route: "watch/session-preview", target: { kind: "preview" } },
};

function shellLocationFromNotification(
  location: NotificationOpenLocation,
): ShellLocation {
  if (location.kind === "watch") {
    return {
      route: "watch/session-preview",
      target: {
        kind: "channel",
        platform: location.platform,
        channelId: location.channelId,
        channelLogin: location.channelLogin,
      },
    };
  }
  if (location.kind === "channel") {
    return {
      route: "more/channel",
      channel: {
        platform: location.platform,
        id: location.id,
        username: location.username,
      },
    };
  }
  if (location.kind === "activity") {
    return { route: "activity/alert-preview", eventId: location.eventId };
  }
  if (location.kind === "job") {
    return { route: "activity/job-preview", jobId: location.jobId };
  }
  if (location.kind === "accounts") return { route: "more/accounts" };
  return { route: "more/diagnostics" };
}

export function AppShell({
  multistream,
  moderation,
  engagement,
  inlineEngagement,
  workflowNavigation,
  onRequestPlatformScopes,
  moderationChat,
  activityRepository,
  developmentActivityProof,
  appLinks,
  capabilityProfile,
  installationPolicy,
  onRetryCapabilityProfile,
  onRefreshCapabilityPolicy,
  onRetryInstallationRegistration,
  onRunCapabilityProfileDevelopmentProof,
  onQueueActivityReadFailure,
  onExitDevelopmentActivityProof,
  onReplayDevelopmentActivityProof,
  onRetryDevelopmentActivityProofCleanup,
  onStartDevelopmentActivityProof,
  developmentStatus,
  onPrepareRestorationProof,
  onRunNativeCapabilityProof,
  onRunPersistenceProof,
  persistenceStatus,
  shellRestoration,
  twitchAccount,
  twitchAccountActions,
  twitchAccountDevelopmentFixture,
  onEnableTwitchDevelopmentFixture,
  onDisableTwitchDevelopmentFixture,
  kickAccount,
  kickAccountActions,
  kickAccountDevelopmentFixture,
  onEnableKickDevelopmentFixture,
  onDisableKickDevelopmentFixture,
  homeDiscovery,
  mediaJobs,
  captions,
  searchHistory,
  discoveryPreferences,
  followingSession,
  connectivitySession,
  adblockSession,
  twitchPlaylistProxySession,
  playlistProxyHealth,
  notificationSession,
  chatDisplaySession,
  predictionSession,
  AndroidNavigationBar,
  nativeNotifications,
  settingsSession,
  supportSession,
  watch,
}: {
  readonly multistream?: MultistreamWorkspaceProps;
  readonly moderation?: ModerationController;
  readonly engagement?: EngagementController;
  readonly inlineEngagement?: ChatEngagementInlineRuntime;
  readonly workflowNavigation?: PlatformWorkflowNavigation;
  readonly onRequestPlatformScopes?: (
    platform: StreamPlatform,
    scopes: readonly string[],
  ) => void;
  readonly moderationChat?: ConnectedChatRuntime;
  readonly activityRepository: ActivityRepository;
  readonly developmentActivityProof: DevelopmentActivityProofViewModel | null;
  readonly appLinks: AppLinkSource;
  readonly capabilityProfile: CapabilityProfileViewModel;
  readonly installationPolicy: InstallationPolicyViewModel;
  readonly onRetryCapabilityProfile: () => void;
  readonly onRefreshCapabilityPolicy: () => void;
  readonly onRetryInstallationRegistration: () => void;
  readonly onRunCapabilityProfileDevelopmentProof: () => Promise<RuntimeObservationDevelopmentProofResult>;
  readonly onQueueActivityReadFailure: () => void;
  readonly onExitDevelopmentActivityProof: () => Promise<void>;
  readonly onReplayDevelopmentActivityProof: () => Promise<void>;
  readonly onRetryDevelopmentActivityProofCleanup: () => Promise<void>;
  readonly onStartDevelopmentActivityProof: () => Promise<void>;
  readonly developmentStatus: DevelopmentClientViewModel;
  readonly onPrepareRestorationProof: (
    kind: "corrupt" | "unsupported",
  ) => Promise<void>;
  readonly onRunNativeCapabilityProof: () => Promise<{
    readonly detail: string;
  }>;
  readonly onRunPersistenceProof: () => Promise<void>;
  readonly persistenceStatus: PersistenceViewModel;
  readonly shellRestoration: ShellRestorationRepository;
  readonly twitchAccount: TwitchAccountViewModel;
  readonly twitchAccountActions: TwitchAccountActions;
  readonly twitchAccountDevelopmentFixture: boolean;
  readonly onEnableTwitchDevelopmentFixture?: (() => void) | undefined;
  readonly onDisableTwitchDevelopmentFixture?: (() => void) | undefined;
  readonly kickAccount: KickAccountSessionSnapshot;
  readonly kickAccountActions: KickAccountActions;
  readonly kickAccountDevelopmentFixture: boolean;
  readonly onEnableKickDevelopmentFixture?: (() => void) | undefined;
  readonly onDisableKickDevelopmentFixture?: (() => void) | undefined;
  readonly homeDiscovery: DiscoverySession;
  readonly mediaJobs: MediaJobWorkflow;
  readonly captions: LocalCaptionsPort;
  readonly searchHistory: SearchHistoryRepository;
  readonly discoveryPreferences: DiscoveryPreferenceStore;
  readonly followingSession: FollowingSession;
  readonly connectivitySession: ConnectivitySession;
  readonly adblockSession: AdBlockSession;
  readonly twitchPlaylistProxySession: TwitchPlaylistProxySession;
  readonly playlistProxyHealth: PlaylistProxyHealth;
  readonly notificationSession: NotificationSettingsSession;
  readonly chatDisplaySession: ChatDisplaySettingsSession;
  readonly predictionSession: PredictionSettingsSession;
  readonly AndroidNavigationBar: ComponentType<{ readonly hidden: boolean }>;
  readonly nativeNotifications: NativeNotificationRuntime;
  readonly settingsSession: SettingsSession;
  readonly supportSession: SupportSettingsSession;
  readonly watch: WatchScreenRuntime;
}) {
  const activityRepositoryEpoch =
    developmentActivityProof?.kind === "proof" ||
    (developmentActivityProof?.kind === "cleanup-required" &&
      developmentActivityProof.selected)
      ? developmentActivityProof.namespace
      : "main";
  const listActivityMembership = useCallback(
    () => followingSession.listMembership(),
    [followingSession],
  );
  const activity = useActivityController({
    epoch: activityRepositoryEpoch,
    listMembership: listActivityMembership,
    repository: activityRepository,
  });
  const settings = useSettingsSession(settingsSession);
  const lifecycle = useShellLifecycleController({
    appLinks,
    restoration: shellRestoration,
    restoreSession: settings.view.preferences.restoreSession,
    settingsReady: settings.ready,
  });
  const { dispatch, launchSearchQuery, state: navigation } = lifecycle;
  const [notificationBanner, setNotificationBanner] = useState(
    nativeNotifications.peekBanner(),
  );
  const location = getActiveShellLocation(navigation);
  const watchingWatch =
    location.route === "watch" || location.route === "watch/session-preview";
  const watchOwnsChrome =
    location.route === "watch/session-preview" &&
    location.target.kind === "channel";
  const watchPeek = useWatchPeek(watch.runtime.session);
  const pictureInPictureSurface =
    watchPeek.kind === "active" &&
    isPictureInPictureSurface(watchPeek.presentation);
  const fullscreen =
    watchingWatch &&
    watchPeek.kind === "active" &&
    watchPeek.presentation.presentation === "fullscreen";
  const playerOnlySurface = pictureInPictureSurface || fullscreen;

  useEffect(() => {
    nativeNotifications.bindOpen((openLocation) => {
      dispatch({
        type: "navigate",
        location: shellLocationFromNotification(openLocation),
      });
    });
    return nativeNotifications.subscribe(() => {
      setNotificationBanner(nativeNotifications.peekBanner());
      void activity.refresh();
      void notificationSession.load();
    });
  }, [activity, dispatch, nativeNotifications, notificationSession]);
  useEffect(() => {
    if (watchingWatch || pictureInPictureSurface) {
      watch.runtime.session.reveal();
      return;
    }
    watch.runtime.session.conceal();
  }, [pictureInPictureSurface, watchingWatch, watch.runtime.session]);
  const selectedJobId =
    location.route === "activity/job-preview"
      ? location.jobId
      : (watchMediaJobIdFor(location, watchPeek) ?? undefined);
  const mediaJobsController = useMediaJobsController({
    selectedJobId,
    workflow: mediaJobs,
  });
  const captionsController = useLocalCaptionsController({ port: captions });
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const keyboardInset = keyboard.inset;
  const readNetwork = useCallback(
    () => connectivitySession.readNetwork(),
    [connectivitySession],
  );
  const networkStatus = useNetworkStatus({
    enabled: !playerOnlySurface,
    readNetwork,
  });
  const placement = getShellNavigationPlacement(width);

  const cancelDismissal = activity.cancelDismissal;
  const hasDismissalConfirmation =
    activity.model.dismissalConfirmation !== null;

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        const decision = resolveHardwareBack({
          canNavigateBack: canNavigateBack(navigation),
          fullscreen,
          hasOverlay: hasDismissalConfirmation,
          watchingStream: watchingWatch && watchPeek.kind === "active",
        });
        if (decision === "exit-fullscreen") {
          watch.runtime.session.exitFullscreen();
          return true;
        }
        if (decision === "cancel-dismissal") {
          cancelDismissal();
          return true;
        }
        if (decision === "navigate-back") {
          dispatch({ type: "back" });
          return true;
        }
        return false;
      },
    );
    return () => subscription.remove();
  }, [
    cancelDismissal,
    dispatch,
    fullscreen,
    hasDismissalConfirmation,
    navigation,
    watchingWatch,
    watchPeek.kind,
    watch.runtime.session,
  ]);

  const navigationView = (bottomInset = 0) => (
    <PrimaryNavigation
      activityUnreadCount={activity.model.unreadCount}
      bottomInset={bottomInset}
      dispatch={dispatch}
      key={`${placement}:${width}:${fontScale}`}
      placement={placement}
      state={navigation}
    />
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "android" ? "height" : undefined}
      enabled={Platform.OS === "android" && !playerOnlySurface}
      style={styles.app}
      testID="development-client-ready"
    >
      <View
        accessibilityLabel="StreamFusion app shell"
        style={[
          styles.safeFrame,
          {
            paddingBottom: playerOnlySurface
              ? 0
              : safeFrameBottomInset({
                  applyKeyboardOverlay: Platform.OS !== "android",
                  fallbackInset: placement === "rail" ? insets.bottom : 0,
                  keyboardInset,
                  pictureInPicture: pictureInPictureSurface,
                }),
            paddingLeft: playerOnlySurface ? 0 : insets.left,
            paddingRight: playerOnlySurface ? 0 : insets.right,
            paddingTop: playerOnlySurface ? 0 : insets.top,
          },
        ]}
        testID="app-shell-ready"
      >
        <View
          style={placement === "rail" ? styles.railLayout : styles.phoneLayout}
        >
          {placement === "rail" && !playerOnlySurface ? navigationView() : null}
          <View style={styles.workspace}>
            {playerOnlySurface || watchOwnsChrome ? null : (
              <ShellHeader dispatch={dispatch} state={navigation} />
            )}
            {playerOnlySurface ? null : (
              <RestorationNotice
                developmentDiagnostic={
                  __DEV__ ? persistenceStatus.developmentDiagnostic : null
                }
                status={lifecycle.status}
              />
            )}
            {playerOnlySurface ? null : (
              <MobileConnectivityBanner status={networkStatus.status} />
            )}
            {playerOnlySurface ? null : (
              <UpdateAvailableNotice session={supportSession} />
            )}
            {notificationBanner && !playerOnlySurface ? (
              <InAppNotificationBannerView
                banner={notificationBanner}
                onDismiss={() => nativeNotifications.dismissBanner()}
                onOpen={() => {
                  dispatch({
                    type: "navigate",
                    location: shellLocationFromNotification(
                      notificationBanner.location,
                    ),
                  });
                  nativeNotifications.dismissBanner();
                }}
              />
            ) : null}
            <ShellScreen
              {...(moderationChat ? { moderationChat } : {})}
              {...(moderation === undefined ? {} : { moderation })}
              {...(engagement === undefined ? {} : { engagement })}
              {...(inlineEngagement === undefined ? {} : { inlineEngagement })}
              {...(workflowNavigation === undefined
                ? {}
                : { workflowNavigation })}
              {...(onRequestPlatformScopes === undefined
                ? {}
                : { onRequestPlatformScopes })}
              {...(multistream === undefined ? {} : { multistream })}
              activity={activity}
              offline={networkStatus.status === "offline"}
              capabilityProfile={capabilityProfile}
              installationPolicy={installationPolicy}
              developmentStatus={developmentStatus}
              dispatch={dispatch}
              onPrepareRestorationProof={onPrepareRestorationProof}
              onRetryCapabilityProfile={onRetryCapabilityProfile}
              onRefreshCapabilityPolicy={onRefreshCapabilityPolicy}
              onRetryInstallationRegistration={onRetryInstallationRegistration}
              onRunCapabilityProfileDevelopmentProof={
                onRunCapabilityProfileDevelopmentProof
              }
              onQueueActivityReadFailure={onQueueActivityReadFailure}
              developmentActivityProof={developmentActivityProof}
              onExitDevelopmentActivityProof={onExitDevelopmentActivityProof}
              onReplayDevelopmentActivityProof={
                onReplayDevelopmentActivityProof
              }
              onRetryDevelopmentActivityProofCleanup={
                onRetryDevelopmentActivityProofCleanup
              }
              onStartDevelopmentActivityProof={onStartDevelopmentActivityProof}
              onRunNativeCapabilityProof={onRunNativeCapabilityProof}
              onRunPersistenceProof={onRunPersistenceProof}
              persistenceStatus={persistenceStatus}
              state={navigation}
              twitchAccount={twitchAccount}
              twitchAccountActions={twitchAccountActions}
              twitchAccountDevelopmentFixture={twitchAccountDevelopmentFixture}
              onEnableTwitchDevelopmentFixture={
                onEnableTwitchDevelopmentFixture
              }
              onEnableKickDevelopmentFixture={onEnableKickDevelopmentFixture}
              kickAccount={kickAccount}
              kickAccountActions={kickAccountActions}
              kickAccountDevelopmentFixture={kickAccountDevelopmentFixture}
              onDisableKickDevelopmentFixture={onDisableKickDevelopmentFixture}
              onDisableTwitchDevelopmentFixture={
                onDisableTwitchDevelopmentFixture
              }
              homeDiscovery={homeDiscovery}
              mediaJobsController={mediaJobsController}
              captionsController={captionsController}
              launchSearchQuery={launchSearchQuery}
              searchHistory={searchHistory}
              discoveryPreferences={discoveryPreferences}
              followingSession={followingSession}
              connectivitySession={connectivitySession}
              adblockSession={adblockSession}
              twitchPlaylistProxySession={twitchPlaylistProxySession}
              playlistProxyHealth={playlistProxyHealth}
              notificationSession={notificationSession}
              chatDisplaySession={chatDisplaySession}
              predictionSession={predictionSession}
              onPresentNotificationProof={() =>
                nativeNotifications.presentProof(
                  proofLivePayload(new Date().toISOString()),
                )
              }
              playerPrefs={settings.view.preferences}
              settingsSession={settingsSession}
              supportSession={supportSession}
              watch={watch}
            />
            <WatchMiniPlayerHost
              PlayerSurface={watch.PlayerSurface}
              hidden={watchingWatch || playerOnlySurface}
              onExpand={(target) => {
                watch.runtime.session.reveal();
                dispatch({
                  type: "navigate",
                  location: {
                    route: "watch/session-preview",
                    target: {
                      channelId: target.channelId,
                      channelLogin: target.channelName,
                      kind: "channel",
                      platform: target.platform,
                    },
                  },
                });
              }}
              session={watch.runtime.session}
            />
          </View>
        </View>
        {placement === "bottom" && !playerOnlySurface && !keyboard.open ? (
          <View style={{ flexShrink: 0 }}>
            {navigationView(bottomNavigationSafeInset(insets.bottom))}
          </View>
        ) : null}
      </View>
      <StatusBar hidden={fullscreen} style="light" />
      <AndroidNavigationBar hidden={fullscreen} />
    </KeyboardAvoidingView>
  );
}

function RestorationNotice({
  developmentDiagnostic,
  status,
}: {
  readonly developmentDiagnostic: string | null;
  readonly status: ShellLifecycleStatus;
}) {
  if (
    status !== "fallback-corrupt" &&
    status !== "fallback-unsupported" &&
    status !== "persistence-unavailable" &&
    status !== "write-failed"
  )
    return null;
  return (
    <View
      accessible
      style={styles.restorationNotice}
      testID="navigation-restoration-fallback"
    >
      <Text selectable style={styles.cardBody}>
        {status === "fallback-corrupt"
          ? "Saved navigation was damaged and reset safely."
          : status === "fallback-unsupported"
            ? "Saved navigation used an unsupported version and reset safely."
            : status === "write-failed"
              ? "Navigation changes could not be saved. Your next change will retry."
              : "Saved navigation is unavailable. You can keep using the app."}
      </Text>
      {developmentDiagnostic ? (
        <Text
          selectable
          style={styles.cardBody}
          testID="development-persistence-startup-diagnostic"
        >
          Development storage diagnostic: {developmentDiagnostic}
        </Text>
      ) : null}
    </View>
  );
}

function ShellHeader({
  dispatch,
  state,
}: {
  readonly dispatch: (action: ShellNavigationAction) => void;
  readonly state: ShellNavigationState;
}) {
  const route = getActiveShellRoute(state);
  const location = getActiveShellLocation(state);
  const header = resolveShellHeaderCopy(location, route);
  const showsBack = canNavigateBack(state);
  return (
    <View style={styles.header}>
      {showsBack ? (
        <MobileIconButton
          hint={`Returns to ${SHELL_ROUTES[state.activeDestination].title}`}
          label="Back"
          onPress={() => dispatch({ type: "back" })}
          testID="shell-back"
        >
          <ArrowLeft
            accessibilityElementsHidden
            color={mobileColors.textPrimary}
            size={mobileSizing.icon}
          />
        </MobileIconButton>
      ) : null}
      <View accessible style={styles.headerTitle}>
        <Text accessibilityRole="header" selectable style={styles.headerText}>
          {header.title}
        </Text>
      </View>
      <View style={styles.headerTrailing}>
        <MobileIconButton
          hint="Opens Settings inside More"
          label="Settings"
          onPress={() =>
            dispatch({ type: "navigate", location: { route: "more/settings" } })
          }
          testID="shell-settings"
        >
          <MobileSettingsIcon
            accessibilityElementsHidden
            color={mobileColors.textPrimary}
            size={mobileSizing.icon}
          />
        </MobileIconButton>
        <MobileIconButton
          hint="Opens Accounts inside More"
          label="Connected Accounts"
          onPress={() =>
            dispatch({ type: "navigate", location: { route: "more/accounts" } })
          }
          testID="shell-accounts"
        >
          <CircleUserRound
            accessibilityElementsHidden
            color={mobileColors.textPrimary}
            size={mobileSizing.icon}
          />
        </MobileIconButton>
      </View>
    </View>
  );
}

function ShellScreen({
  offline,
  multistream,
  moderation,
  engagement,
  inlineEngagement,
  workflowNavigation,
  onRequestPlatformScopes,
  moderationChat,
  activity,
  developmentActivityProof,
  capabilityProfile,
  installationPolicy,
  developmentStatus,
  dispatch,
  onPrepareRestorationProof,
  onRetryCapabilityProfile,
  onRefreshCapabilityPolicy,
  onRetryInstallationRegistration,
  onRunCapabilityProfileDevelopmentProof,
  onQueueActivityReadFailure,
  onExitDevelopmentActivityProof,
  onReplayDevelopmentActivityProof,
  onRetryDevelopmentActivityProofCleanup,
  onStartDevelopmentActivityProof,
  onRunNativeCapabilityProof,
  onRunPersistenceProof,
  persistenceStatus,
  state,
  twitchAccount,
  twitchAccountActions,
  twitchAccountDevelopmentFixture,
  onEnableTwitchDevelopmentFixture,
  onDisableTwitchDevelopmentFixture,
  kickAccount,
  kickAccountActions,
  kickAccountDevelopmentFixture,
  onEnableKickDevelopmentFixture,
  onDisableKickDevelopmentFixture,
  homeDiscovery,
  mediaJobsController,
  captionsController,
  launchSearchQuery,
  searchHistory,
  discoveryPreferences,
  followingSession,
  connectivitySession,
  adblockSession,
  twitchPlaylistProxySession,
  playlistProxyHealth,
  notificationSession,
  chatDisplaySession,
  predictionSession,
  onPresentNotificationProof,
  playerPrefs,
  settingsSession,
  supportSession,
  watch,
}: {
  readonly offline: boolean;
  readonly multistream?: MultistreamWorkspaceProps;
  readonly moderation?: ModerationController;
  readonly engagement?: EngagementController;
  readonly inlineEngagement?: ChatEngagementInlineRuntime;
  readonly workflowNavigation?: PlatformWorkflowNavigation;
  readonly onRequestPlatformScopes?: (
    platform: StreamPlatform,
    scopes: readonly string[],
  ) => void;
  readonly moderationChat?: ConnectedChatRuntime;
  readonly activity: ReturnType<typeof useActivityController>;
  readonly developmentActivityProof: DevelopmentActivityProofViewModel | null;
  readonly capabilityProfile: CapabilityProfileViewModel;
  readonly installationPolicy: InstallationPolicyViewModel;
  readonly developmentStatus: DevelopmentClientViewModel;
  readonly dispatch: (action: ShellNavigationAction) => void;
  readonly onPrepareRestorationProof: (
    kind: "corrupt" | "unsupported",
  ) => Promise<void>;
  readonly onRetryCapabilityProfile: () => void;
  readonly onRefreshCapabilityPolicy: () => void;
  readonly onRetryInstallationRegistration: () => void;
  readonly onRunCapabilityProfileDevelopmentProof: () => Promise<RuntimeObservationDevelopmentProofResult>;
  readonly onQueueActivityReadFailure: () => void;
  readonly onExitDevelopmentActivityProof: () => Promise<void>;
  readonly onReplayDevelopmentActivityProof: () => Promise<void>;
  readonly onRetryDevelopmentActivityProofCleanup: () => Promise<void>;
  readonly onStartDevelopmentActivityProof: () => Promise<void>;
  readonly onRunNativeCapabilityProof: () => Promise<{
    readonly detail: string;
  }>;
  readonly onRunPersistenceProof: () => Promise<void>;
  readonly persistenceStatus: PersistenceViewModel;
  readonly state: ShellNavigationState;
  readonly twitchAccount: TwitchAccountViewModel;
  readonly twitchAccountActions: TwitchAccountActions;
  readonly twitchAccountDevelopmentFixture: boolean;
  readonly onEnableTwitchDevelopmentFixture?: (() => void) | undefined;
  readonly onDisableTwitchDevelopmentFixture?: (() => void) | undefined;
  readonly kickAccount: KickAccountSessionSnapshot;
  readonly kickAccountActions: KickAccountActions;
  readonly kickAccountDevelopmentFixture: boolean;
  readonly onEnableKickDevelopmentFixture?: (() => void) | undefined;
  readonly onDisableKickDevelopmentFixture?: (() => void) | undefined;
  readonly homeDiscovery: DiscoverySession;
  readonly mediaJobsController: ReturnType<typeof useMediaJobsController>;
  readonly captionsController: ReturnType<typeof useLocalCaptionsController>;
  readonly launchSearchQuery: string | null;
  readonly searchHistory: SearchHistoryRepository;
  readonly discoveryPreferences: DiscoveryPreferenceStore;
  readonly followingSession: FollowingSession;
  readonly connectivitySession: ConnectivitySession;
  readonly adblockSession: AdBlockSession;
  readonly twitchPlaylistProxySession: TwitchPlaylistProxySession;
  readonly playlistProxyHealth: PlaylistProxyHealth;
  readonly notificationSession: NotificationSettingsSession;
  readonly chatDisplaySession: ChatDisplaySettingsSession;
  readonly predictionSession: PredictionSettingsSession;
  readonly onPresentNotificationProof: () => Promise<void>;
  readonly playerPrefs: ProductPreferences;
  readonly settingsSession: SettingsSession;
  readonly supportSession: SupportSettingsSession;
  readonly watch: WatchScreenRuntime;
}) {
  const route = getActiveShellRoute(state);
  const location = getActiveShellLocation(state);
  const focusedWatch = useWatchPeek(watch.runtime.session);
  const scrollView = useRef<ScrollView>(null);
  const scrollRequest = state.rootScrollRequests[state.activeDestination];
  const [diagnosticsTab, setDiagnosticsTab] =
    useState<MobileDiagnosticsTab>("overview");
  const [engagementChannel, setEngagementChannel] =
    useState<ModerationChannel | null>(null);
  const [moderationTarget, setModerationTarget] = useState<{
    readonly channel: ModerationChannel;
    readonly userId: string;
    readonly messageId: string;
  } | null>(null);
  const [restoredModeration, setRestoredModeration] =
    useState<ModerationScopeReturn | null>(null);
  const [scopeReturn, setScopeReturn] = useState<{
    readonly platform: StreamPlatform;
    readonly scopes: readonly string[];
    readonly context: ModerationScopeReturn;
  } | null>(null);
  const [previousWorkflowRoute, setPreviousWorkflowRoute] = useState(
    location.route,
  );
  if (previousWorkflowRoute !== location.route) {
    setPreviousWorkflowRoute(location.route);
    if (previousWorkflowRoute === "more/accounts") setScopeReturn(null);
    if (previousWorkflowRoute === "more/moderation") {
      setModerationTarget(null);
      setRestoredModeration(null);
    }
  }
  const requestScopes = (
    platform: StreamPlatform,
    scopes: readonly string[],
    returnTo?: ModerationScopeReturn,
  ) => {
    if (returnTo) setScopeReturn({ platform, scopes, context: returnTo });
    dispatch({ type: "navigate", location: { route: "more/accounts" } });
    onRequestPlatformScopes?.(platform, scopes);
  };
  useEffect(() => {
    if (!scopeReturn || location.route !== "more/accounts") return;
    const account =
      scopeReturn.platform === "twitch" ? twitchAccount : kickAccount;
    if (
      account.kind !== "connected" ||
      !scopeReturn.scopes.every((scope) => account.scopes.includes(scope))
    )
      return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setRestoredModeration(scopeReturn.context);
      setScopeReturn(null);
      dispatch({ type: "navigate", location: { route: "more/moderation" } });
    });
    return () => {
      cancelled = true;
    };
  }, [scopeReturn, twitchAccount, kickAccount, location.route, dispatch]);
  const engagementSheet =
    engagement && engagementChannel && workflowNavigation ? (
      <EngagementSheet
        channel={engagementChannel}
        controller={engagement}
        visible
        onDismiss={() => setEngagementChannel(null)}
        onOpenProvider={(channel) => {
          void workflowNavigation.openChannel(channel);
        }}
        onRequestScopes={requestScopes}
      />
    ) : null;

  useEffect(() => {
    scrollView.current?.scrollTo({ animated: false, y: 0 });
  }, [scrollRequest]);

  const openWatch = (target: WatchTarget) => {
    dispatch({
      type: "navigate",
      location: {
        route: "watch/session-preview",
        target: locationTargetFromWatch(target),
      },
    });
  };

  if (location.route === "more/multistream" && multistream) {
    return <MultistreamWorkspace {...multistream} />;
  }

  if (
    location.route === "watch" ||
    location.route === "watch/session-preview"
  ) {
    const target = watchTargetFor(location, focusedWatch);
    const mediaJobSession = watchMediaJobSession(
      mediaJobsController,
      activity.refresh,
    );
    return (
      <View style={styles.activityWorkspace} testID="screen-watch-root">
        <WatchRoute
          {...(target && inlineEngagement && workflowNavigation
            ? {
                inlineEngagement: {
                  ...inlineEngagement,
                  onOpenProvider: (channel: ModerationChannel) => {
                    void workflowNavigation.openChannel(channel);
                  },
                },
              }
            : {})}
          {...(target && engagement
            ? {
                onOpenEngagement: () =>
                  setEngagementChannel({
                    platform: target.platform,
                    id: target.channelId,
                    login: target.channelName,
                    name: target.channelName,
                  }),
              }
            : {})}
          {...(target && moderation
            ? {
                onModerateMessage: (message) => {
                  setModerationTarget({
                    channel: {
                      platform: target.platform,
                      id: target.channelId,
                      login: target.channelName,
                      name: target.channelName,
                    },
                    userId: message.userId ?? "",
                    messageId: message.id,
                  });
                  dispatch({
                    type: "navigate",
                    location: { route: "more/moderation" },
                  });
                },
              }
            : {})}
          captions={watchCaptionSession(captionsController)}
          discovery={{
            onOpenAccounts: () =>
              dispatch({
                type: "navigate",
                location: { route: "more/accounts" },
              }),
            session: homeDiscovery,
          }}
          download={mediaJobSession}
          following={followingSession}
          recording={mediaJobSession}
          onBack={() => dispatch({ type: "back" })}
          onOpenChannel={(watchTarget) =>
            dispatch({
              type: "navigate",
              location: {
                channel: {
                  id: watchTarget.channelId,
                  platform: watchTarget.platform,
                  username: watchTarget.channelName,
                },
                route: "more/channel",
              },
            })
          }
          onOpenRelated={(stream) =>
            openWatch({
              channelId: stream.channelId,
              channelName: stream.channelName,
              platform: stream.platform,
            })
          }
          onOpenSearch={() =>
            dispatch({ type: "select", destination: "search" })
          }
          playerPrefs={playerPrefs}
          screen={watch}
          target={target}
        />
        {engagementSheet}
      </View>
    );
  }

  if (location.route === "activity") {
    return (
      <View style={styles.activityWorkspace} testID="screen-activity-root">
        <ActivityScreen
          developmentProof={developmentActivityProof}
          model={activity.model}
          onCancelDismissal={activity.cancelDismissal}
          onConfirmDismissal={activity.confirmDismissal}
          onDismissVisibleCompleted={activity.dismissAllCompleted}
          onExitDevelopmentProof={onExitDevelopmentActivityProof}
          onRetryDevelopmentProof={onRetryDevelopmentActivityProofCleanup}
          onMarkAllRead={activity.markAllRead}
          onOpen={(nextLocation) =>
            dispatch({ type: "navigate", location: nextLocation })
          }
          onRefresh={activity.refresh}
          scrollRequest={scrollRequest}
        />
      </View>
    );
  }

  if (location.route === "activity/alert-preview") {
    return (
      <View
        style={styles.activityWorkspace}
        testID="screen-activity-alert-preview"
      >
        <ActivityDetailScreen
          developmentProof={developmentActivityProof}
          dismissalConfirmation={activity.model.dismissalConfirmation}
          dismissalFailure={activity.model.dismissalFailure}
          dismissalResult={activity.model.dismissalResult}
          eventId={location.eventId}
          isDismissing={activity.model.isDismissing}
          isMarkingRead={activity.model.markingReadEventIds.includes(
            location.eventId,
          )}
          items={activity.model.allItems}
          mutationFailure={activity.model.mutationFailure}
          onCancelDismissal={activity.cancelDismissal}
          onConfirmDismissal={activity.confirmDismissal}
          onMarkRead={activity.markRead}
          onDismissItem={activity.dismissItem}
          onExitDevelopmentProof={onExitDevelopmentActivityProof}
          onRetryDevelopmentProof={onRetryDevelopmentActivityProofCleanup}
          onOpen={(nextLocation) =>
            dispatch({ type: "navigate", location: nextLocation })
          }
        />
      </View>
    );
  }

  if (location.route === "activity/job-preview") {
    return (
      <ScrollView
        contentContainerStyle={styles.screenContent}
        contentInsetAdjustmentBehavior="automatic"
        ref={scrollView}
        style={styles.screenScroll}
        testID="screen-activity-job-preview"
      >
        <View style={styles.contentColumn}>
          <MediaJobScreen
            busy={mediaJobsController.model.busy}
            onCommand={(command) => {
              void mediaJobsController.apply(command).then(() => {
                void activity.refresh();
              });
            }}
            onDelete={() => {
              void mediaJobsController.deleteJob().then(() => {
                void activity.refresh();
              });
            }}
            onExport={() => {
              void mediaJobsController.exportJob();
            }}
            onOpen={() => {
              void mediaJobsController.openArtifact();
            }}
            snapshot={mediaJobsController.model.selected}
            status={mediaJobsController.model.status}
          />
        </View>
      </ScrollView>
    );
  }

  if (location.route === "following" || location.route === "following/manage") {
    return (
      <View
        style={styles.activityWorkspace}
        testID={
          location.route === "following"
            ? "screen-following-root"
            : "screen-following-manage"
        }
      >
        <FollowingWorkspace
          onOpenCategory={(category) =>
            dispatch({
              type: "navigate",
              location: { category, route: "more/category-detail" },
            })
          }
          onOpenChannel={(channel) =>
            dispatch({
              type: "navigate",
              location: { channel, route: "following/channel-preview" },
            })
          }
          onOpenManage={() =>
            dispatch({
              type: "navigate",
              location: { route: "following/manage" },
            })
          }
          onOpenSearch={() =>
            dispatch({ type: "select", destination: "search" })
          }
          onWatch={openWatch}
          route={location.route}
          session={followingSession}
        />
      </View>
    );
  }

  if (location.route === "search") {
    return (
      <View style={styles.activityWorkspace} testID="screen-search-root">
        <UnifiedSearchScreen
          key={launchSearchQuery ?? "search-root"}
          {...(launchSearchQuery ? { initialQuery: launchSearchQuery } : {})}
          categoriesPanel={
            <CategoriesScreen
              followingSession={followingSession}
              embedded
              onOpenAccounts={() =>
                dispatch({
                  type: "navigate",
                  location: { route: "more/accounts" },
                })
              }
              onOpenCategory={(category) =>
                dispatch({
                  type: "navigate",
                  location: { category, route: "more/category-detail" },
                })
              }
              preferences={discoveryPreferences}
              session={homeDiscovery}
            />
          }
          history={searchHistory}
          onOpenAccounts={() =>
            dispatch({ type: "navigate", location: { route: "more/accounts" } })
          }
          onOpenChannel={(channel) =>
            dispatch({
              type: "navigate",
              location: { channel, route: "search/result-preview" },
            })
          }
          onWatch={openWatch}
          session={homeDiscovery}
        />
      </View>
    );
  }

  if (
    location.route === "more/channel" ||
    location.route === "search/result-preview" ||
    location.route === "following/channel-preview"
  ) {
    return (
      <View
        style={styles.activityWorkspace}
        testID={`screen-${SHELL_ROUTES[location.route].reviewId}`}
      >
        <ChannelDetailScreen
          channel={location.channel}
          following={followingSession}
          onWatch={openWatch}
          session={homeDiscovery}
        />
      </View>
    );
  }

  if (location.route === "more/categories") {
    return (
      <View style={styles.activityWorkspace} testID="screen-more-categories">
        <CategoriesScreen
          followingSession={followingSession}
          onOpenAccounts={() =>
            dispatch({ type: "navigate", location: { route: "more/accounts" } })
          }
          onOpenCategory={(category) =>
            dispatch({
              type: "navigate",
              location: { category, route: "more/category-detail" },
            })
          }
          preferences={discoveryPreferences}
          session={homeDiscovery}
        />
      </View>
    );
  }

  if (location.route === "more/category-detail") {
    return (
      <View
        style={styles.activityWorkspace}
        testID="screen-more-category-detail"
      >
        <CategoryDetailScreen
          category={location.category}
          onOpenAccounts={() =>
            dispatch({ type: "navigate", location: { route: "more/accounts" } })
          }
          preferences={discoveryPreferences}
          session={homeDiscovery}
        />
      </View>
    );
  }

  if (location.route === "more/history") {
    return (
      <View style={styles.activityWorkspace} testID="screen-more-history">
        <HistoryScreen
          onWatch={openWatch}
          readNetwork={() => connectivitySession.readNetwork()}
          repository={watch.history}
        />
      </View>
    );
  }

  if (location.route === "more/downloads") {
    return (
      <View style={styles.activityWorkspace} testID="screen-more-downloads">
        <DownloadsScreen
          offline={offline}
          jobs={mediaJobsController.model.jobs}
          onOpenJob={(jobId) =>
            dispatch({
              type: "navigate",
              location: { route: "activity/job-preview", jobId },
            })
          }
          onRefresh={() => mediaJobsController.refresh()}
        />
      </View>
    );
  }

  if (location.route === "more/accounts") {
    return (
      <ScrollView
        contentContainerStyle={styles.screenContent}
        contentInsetAdjustmentBehavior="automatic"
        ref={scrollView}
        style={styles.screenScroll}
        testID="screen-more-accounts"
      >
        <View style={styles.contentColumn}>
          <TwitchAccountsPanel
            actions={twitchAccountActions}
            developmentFixture={twitchAccountDevelopmentFixture}
            kickAccount={kickAccount}
            kickAccountActions={kickAccountActions}
            kickAccountDevelopmentFixture={kickAccountDevelopmentFixture}
            model={twitchAccount}
            onDisableDevelopmentFixture={onDisableTwitchDevelopmentFixture}
            onDisableKickDevelopmentFixture={onDisableKickDevelopmentFixture}
            onOpenNotificationSettings={() =>
              dispatch({
                type: "navigate",
                location: { route: "more/settings" },
              })
            }
          />
        </View>
      </ScrollView>
    );
  }

  if (location.route === "more/diagnostics") {
    const support = supportSession.peek();
    return (
      <View style={styles.activityWorkspace} testID="screen-more-diagnostics">
        <DiagnosticsWorkspace
          collectionCopy={diagnosticsCollectionCopy(
            capabilityProfile.phase,
            capabilityProfile.detail,
          )}
          observationCopy={diagnosticsObservationCopy({
            diagnosticIoWindow: support.preferences.diagnosticIoWindow,
            diagnosticWindow: support.preferences.diagnosticWindow,
            observationAgeMs: capabilityProfile.observationAgeMs,
          })}
          onRunCheck={onRetryCapabilityProfile}
          onSelectTab={(tab) =>
            setDiagnosticsTab((current) => parseDiagnosticsTab(tab, current))
          }
          selectedTab={diagnosticsTab}
          slots={diagnosticsWorkspaceSlots({
            activity,
            capabilityProfile,
            captionsController,
            connectivitySession,
            developmentActivityProof,
            developmentStatus,
            dispatch,
            installationPolicy,
            mediaJobsController,
            onExitDevelopmentActivityProof,
            onPrepareRestorationProof,
            onQueueActivityReadFailure,
            onRefreshCapabilityPolicy,
            onReplayDevelopmentActivityProof,
            onRetryCapabilityProfile,
            onRetryDevelopmentActivityProofCleanup,
            onRetryInstallationRegistration,
            onRunCapabilityProfileDevelopmentProof,
            onRunNativeCapabilityProof,
            onRunPersistenceProof,
            onPresentNotificationProof,
            notificationRegistrationCopy:
              notificationSession.peek().registrationCopy,
            onStartDevelopmentActivityProof,
            persistenceStatus,
            supportSession,
            onEnableTwitchDevelopmentFixture,
            onEnableKickDevelopmentFixture,
          })}
        />
      </View>
    );
  }

  if (
    location.route === "more/moderation" &&
    moderation &&
    workflowNavigation
  ) {
    return (
      <View style={styles.activityWorkspace} testID="screen-more-moderation">
        <ModWorkspace
          key={`${moderationTarget?.channel.id ?? "home"}:${moderationTarget?.userId ?? ""}:${moderationTarget?.messageId ?? ""}`}
          controller={moderation}
          {...(restoredModeration?.channel
            ? { initialChannel: restoredModeration.channel }
            : {})}
          {...(restoredModeration?.userId
            ? { initialUserId: restoredModeration.userId }
            : {})}
          {...(restoredModeration?.messageId
            ? { initialMessageId: restoredModeration.messageId }
            : {})}
          {...(restoredModeration?.tool
            ? { initialTool: restoredModeration.tool }
            : {})}
          {...(moderationChat
            ? {
                renderChat: (channel: ModerationChannel) => (
                  <ConnectedChatPanel
                    runtime={moderationChat}
                    target={{
                      platform: channel.platform,
                      channelId: channel.id,
                      channelName: channel.login,
                    }}
                    onModerateMessage={(message) => {
                      setModerationTarget({
                        channel,
                        messageId: message.id,
                        userId:
                          message.userId ??
                          message.username ??
                          message.displayName,
                      });
                    }}
                  />
                ),
              }
            : {})}
          {...(moderationTarget
            ? {
                initialChannel: moderationTarget.channel,
                initialUserId: moderationTarget.userId,
                initialMessageId: moderationTarget.messageId,
              }
            : {})}
          onOpenChannel={(channel) =>
            openWatch({
              platform: channel.platform,
              channelId: channel.id,
              channelName: channel.login,
            })
          }
          onOpenProvider={(channel, platform) => {
            void workflowNavigation.openModeration(channel, platform);
          }}
          onRequestScopes={requestScopes}
          {...(engagement
            ? {
                onOpenEngagement: (channel: ModerationChannel) =>
                  setEngagementChannel(channel),
              }
            : {})}
        />
        {engagementSheet}
      </View>
    );
  }
  if (location.route === "more/settings") {
    return (
      <View style={styles.activityWorkspace} testID="screen-more-settings-root">
        <SettingsWorkspace
          extras={{
            about: <AboutSettingsPanel session={supportSession} />,
            "api-tokens": (
              <ApiTokensSettingsPanel
                kick={kickAccount}
                onOpenIntegrations={() => {
                  dispatch({
                    type: "navigate",
                    location: { route: "more/accounts" },
                  });
                }}
                twitch={twitchAccount}
              />
            ),
            adblock: (
              <AdBlockSettingsWorkspace
                adblock={adblockSession}
                health={playlistProxyHealth}
                playlistProxy={twitchPlaylistProxySession}
              />
            ),
            chat: <ChatSettingsPanel session={chatDisplaySession} />,
            diagnostics: (
              <DiagnosticsSettingsPanel
                onOpenDiagnostics={() => {
                  dispatch({
                    type: "navigate",
                    location: { route: "more/diagnostics" },
                  });
                }}
                session={supportSession}
              />
            ),
            integrations: (
              <IntegrationsSettingsPanel
                kick={kickAccount}
                onOpenAccounts={() => {
                  dispatch({
                    type: "navigate",
                    location: { route: "more/accounts" },
                  });
                }}
                twitch={twitchAccount}
              />
            ),
            logs: <LogsSettingsPanel session={supportSession} />,
            notifications: (
              <NotificationsSettingsPanel session={notificationSession} />
            ),
            predictions: (
              <PredictionsSettingsPanel session={predictionSession} />
            ),
            proxy: <ProxySettingsPanel session={connectivitySession} />,
            "report-bug": <ReportBugSettingsPanel session={supportSession} />,
            updates: <UpdatesSettingsPanel session={supportSession} />,
          }}
          session={settingsSession}
        />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      contentInsetAdjustmentBehavior="automatic"
      ref={scrollView}
      style={styles.screenScroll}
      testID={`screen-${route.reviewId}`}
    >
      <View style={styles.contentColumn}>
        {route.id !== "more" ? (
          <View style={styles.intro}>
            <Text
              accessibilityRole="header"
              selectable
              style={styles.screenTitle}
            >
              {route.title}
            </Text>
            <Text selectable style={styles.screenSummary}>
              {route.summary}
            </Text>
          </View>
        ) : null}
        {route.id === "more" ? (
          <MoreMenu dispatch={dispatch} />
        ) : state.histories[state.activeDestination].trail.length === 0 ? (
          <RootPreviewAction
            destination={state.activeDestination}
            dispatch={dispatch}
          />
        ) : (
          <NestedRouteState location={location} />
        )}
      </View>
    </ScrollView>
  );
}

type DiagnosticsSlotsInput = {
  readonly onEnableTwitchDevelopmentFixture?: (() => void) | undefined;
  readonly onEnableKickDevelopmentFixture?: (() => void) | undefined;
  readonly activity: ReturnType<typeof useActivityController>;
  readonly capabilityProfile: CapabilityProfileViewModel;
  readonly captionsController: ReturnType<typeof useLocalCaptionsController>;
  readonly connectivitySession: ConnectivitySession;
  readonly developmentActivityProof: DevelopmentActivityProofViewModel | null;
  readonly developmentStatus: DevelopmentClientViewModel;
  readonly dispatch: (action: ShellNavigationAction) => void;
  readonly installationPolicy: InstallationPolicyViewModel;
  readonly mediaJobsController: ReturnType<typeof useMediaJobsController>;
  readonly onExitDevelopmentActivityProof: () => Promise<void>;
  readonly onPrepareRestorationProof: (
    kind: "corrupt" | "unsupported",
  ) => Promise<void>;
  readonly onQueueActivityReadFailure: () => void;
  readonly onRefreshCapabilityPolicy: () => void;
  readonly onReplayDevelopmentActivityProof: () => Promise<void>;
  readonly onRetryCapabilityProfile: () => void;
  readonly onRetryDevelopmentActivityProofCleanup: () => Promise<void>;
  readonly onRetryInstallationRegistration: () => void;
  readonly onRunCapabilityProfileDevelopmentProof: () => Promise<RuntimeObservationDevelopmentProofResult>;
  readonly onRunNativeCapabilityProof: () => Promise<{
    readonly detail: string;
  }>;
  readonly onRunPersistenceProof: () => Promise<void>;
  readonly onPresentNotificationProof: () => Promise<void>;
  readonly notificationRegistrationCopy: string;
  readonly onStartDevelopmentActivityProof: () => Promise<void>;
  readonly persistenceStatus: PersistenceViewModel;
  readonly supportSession: SupportSettingsSession;
};

function queueStartedJob(
  start: () => Promise<string>,
  activity: ReturnType<typeof useActivityController>,
  dispatch: (action: ShellNavigationAction) => void,
): () => void {
  return () => {
    void openStartedJob(start, activity, dispatch);
  };
}

function mediaJobStartHandlers(
  jobs: ReturnType<typeof useMediaJobsController>,
  activity: ReturnType<typeof useActivityController>,
  dispatch: (action: ShellNavigationAction) => void,
) {
  return {
    onStartDownload: queueStartedJob(jobs.startDownload, activity, dispatch),
    onStartHttpRange: queueStartedJob(jobs.startHttpRange, activity, dispatch),
    onStartNetworkLoss: queueStartedJob(
      jobs.startNetworkLoss,
      activity,
      dispatch,
    ),
    onStartRecording: queueStartedJob(jobs.startRecording, activity, dispatch),
    onStartCompressedRecording: queueStartedJob(
      jobs.startCompressedRecording,
      activity,
      dispatch,
    ),
    onStartRecordingStoragePressure: queueStartedJob(
      jobs.startRecordingStoragePressure,
      activity,
      dispatch,
    ),
    onStartStoragePressure: queueStartedJob(
      jobs.startStoragePressure,
      activity,
      dispatch,
    ),
  };
}

function diagnosticsTracesSlot(input: DiagnosticsSlotsInput): ReactNode {
  const jobs = input.mediaJobsController;
  return (
    <>
      <MediaJobsDiagnosticsPanel
        busy={jobs.model.busy}
        jobs={jobs.model.jobs}
        status={jobs.model.status}
        onOpenJob={(jobId) =>
          input.dispatch({
            type: "navigate",
            location: { route: "activity/job-preview", jobId },
          })
        }
        onRecover={() => {
          void jobs.recover().then(() => {
            void input.activity.refresh();
          });
        }}
        {...mediaJobStartHandlers(jobs, input.activity, input.dispatch)}
      />
      <LocalCaptionsDiagnosticsHost controller={input.captionsController} />
    </>
  );
}

function diagnosticsDeveloperToolsSlot(
  input: DiagnosticsSlotsInput,
): ReactNode {
  return (
    <>
      {__DEV__ ? (
        <>
          {input.developmentActivityProof ? (
            <DevelopmentActivityProofControl
              model={input.developmentActivityProof}
              onExit={input.onExitDevelopmentActivityProof}
              onQueueReadFailure={input.onQueueActivityReadFailure}
              onRefresh={input.activity.refresh}
              onReplay={input.onReplayDevelopmentActivityProof}
              onRetryCleanup={input.onRetryDevelopmentActivityProofCleanup}
              onStart={input.onStartDevelopmentActivityProof}
            />
          ) : null}
          {input.onEnableTwitchDevelopmentFixture ? (
            <MobileButton
              accessibilityLabel="Run development auth fixture"
              testID="development-twitch-auth-fixture"
              variant="secondary"
              onPress={() => {
                input.onEnableTwitchDevelopmentFixture?.();
                input.dispatch({
                  type: "navigate",
                  location: { route: "more/accounts" },
                });
              }}
            >
              Run development auth fixture
            </MobileButton>
          ) : null}
          {input.onEnableKickDevelopmentFixture ? (
            <MobileButton
              accessibilityLabel="Run development Kick auth fixture"
              testID="development-kick-auth-fixture"
              variant="secondary"
              onPress={() => {
                input.onEnableKickDevelopmentFixture?.();
                input.dispatch({
                  type: "navigate",
                  location: { route: "more/accounts" },
                });
              }}
            >
              Run development Kick auth fixture
            </MobileButton>
          ) : null}
          <DevelopmentResourceFailureProofControl
            onQueue={input.onRunCapabilityProfileDevelopmentProof}
            onRetry={input.onRetryCapabilityProfile}
          />
          <RestorationProofControls
            onPrepare={input.onPrepareRestorationProof}
          />
          <NativeCapabilityStubProofControl
            onRun={input.onRunNativeCapabilityProof}
          />
          <NotificationProofControl
            onPresent={input.onPresentNotificationProof}
            registrationCopy={input.notificationRegistrationCopy}
          />
        </>
      ) : null}
      <DevelopmentStatus model={input.developmentStatus} />
    </>
  );
}

function diagnosticsWorkspaceSlots(
  input: DiagnosticsSlotsInput,
): Record<MobileDiagnosticsTab, ReactNode> {
  return {
    overview: (
      <>
        <CapabilityProfilePanel
          model={input.capabilityProfile}
          onRetry={input.onRetryCapabilityProfile}
        />
        <InstallationPolicyPanel
          model={input.installationPolicy}
          onRefreshCapabilityPolicy={input.onRefreshCapabilityPolicy}
          onRetryInstallationRegistration={
            input.onRetryInstallationRegistration
          }
        />
      </>
    ),
    resources: (
      <CapabilityProfilePanel
        model={input.capabilityProfile}
        onRetry={input.onRetryCapabilityProfile}
      />
    ),
    io: (
      <>
        <ConnectivityDiagnosticsPanel session={input.connectivitySession} />
        <PersistenceStatus
          model={input.persistenceStatus}
          onRunProof={async () => {
            await input.onRunPersistenceProof();
            await input.activity.recordStorageCheck();
          }}
        />
      </>
    ),
    traces: diagnosticsTracesSlot(input),
    "logs-reports": (
      <>
        <LogsSettingsPanel session={input.supportSession} />
        <ReportBugSettingsPanel session={input.supportSession} />
      </>
    ),
    "developer-tools": diagnosticsDeveloperToolsSlot(input),
  };
}

function PersistenceStatus({
  model,
  onRunProof,
}: {
  readonly model: PersistenceViewModel;
  readonly onRunProof: () => Promise<void>;
}) {
  return (
    <View
      accessibilityLabel="Encrypted storage status"
      style={styles.statusPanel}
    >
      <Text selectable style={styles.stateLabel}>
        PRODUCT AND CACHE STORES
      </Text>
      <Text
        selectable
        style={styles.cardTitle}
        testID="persistence-status-title"
      >
        {model.title}
      </Text>
      <Text
        selectable
        style={styles.cardBody}
        testID="persistence-status-detail"
      >
        {model.detail}
      </Text>
      {model.proofDetail ? (
        <Text
          selectable
          style={styles.cardBody}
          testID="persistence-proof-result"
        >
          {model.proofDetail}
        </Text>
      ) : null}
      {model.canRunProof ? (
        <Pressable
          accessibilityHint="Runs isolated encryption, migration, recovery, cache, and backup checks"
          accessibilityLabel="Run native storage checks"
          accessibilityRole="button"
          accessibilityState={{ disabled: model.proofRunning }}
          android_ripple={{ color: mobileColors.surfaceRaised }}
          disabled={model.proofRunning}
          onPress={() => void onRunProof()}
          style={({ pressed }) => [
            styles.proofButton,
            pressed ? styles.pressed : null,
          ]}
          testID="run-persistence-proof"
        >
          <Text selectable style={styles.proofButtonLabel}>
            {model.proofRunning
              ? "Running checks"
              : "Run native storage checks"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function RestorationProofControls({
  onPrepare,
}: {
  readonly onPrepare: (kind: "corrupt" | "unsupported") => Promise<void>;
}) {
  const [detail, setDetail] = useState<string | null>(null);

  const prepare = async (kind: "corrupt" | "unsupported") => {
    try {
      await onPrepare(kind);
      setDetail(
        `Prepared ${kind} navigation state. Reopen the app to verify safe reset.`,
      );
    } catch {
      setDetail("Navigation fallback proof could not be prepared. Try again.");
    }
  };

  return (
    <View style={styles.statusPanel} testID="restoration-proof-controls">
      <Text selectable style={styles.stateLabel}>
        NAVIGATION FALLBACK CHECKS
      </Text>
      {detail ? (
        <Text
          selectable
          style={styles.cardBody}
          testID="restoration-proof-result"
        >
          {detail}
        </Text>
      ) : null}
      {(["corrupt", "unsupported"] as const).map((kind) => (
        <Pressable
          accessibilityLabel={`Prepare ${kind} navigation fallback`}
          accessibilityRole="button"
          android_ripple={{ color: mobileColors.surfaceRaised }}
          key={kind}
          onPress={() => void prepare(kind)}
          style={({ pressed }) => [
            styles.proofButton,
            pressed ? styles.pressed : null,
          ]}
          testID={`prepare-${kind}-restoration`}
        >
          <Text selectable style={styles.proofButtonLabel}>
            {`Prepare ${kind} fallback`}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function RootPreviewAction({
  destination,
  dispatch,
}: {
  readonly destination: ShellDestination["id"];
  readonly dispatch: (action: ShellNavigationAction) => void;
}) {
  const target = previewRoutes[destination];
  if (!target) {
    return null;
  }
  const targetRoute = SHELL_ROUTES[target.route];
  return (
    <Pressable
      accessibilityHint={`Opens ${targetRoute.title} inside ${SHELL_ROUTES[destination].title}`}
      accessibilityLabel={`Open ${targetRoute.title}`}
      accessibilityRole="button"
      android_ripple={{ color: mobileColors.surfaceRaised }}
      onPress={() => dispatch({ type: "navigate", location: target })}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={`open-${targetRoute.reviewId}`}
    >
      <View style={styles.cardCopy}>
        <Text selectable style={styles.cardTitle}>
          {targetRoute.title}
        </Text>
        <Text selectable style={styles.cardBody}>
          {targetRoute.summary}
        </Text>
      </View>
      <ChevronRight
        accessibilityElementsHidden
        color={mobileColors.textSecondary}
        size={mobileSizing.icon}
      />
    </Pressable>
  );
}

function watchCaptionSession(
  controller: ReturnType<typeof useLocalCaptionsController>,
): WatchCaptionSession {
  return {
    busy: controller.model.busy,
    cueText: controller.model.cueText,
    model: controller.model.model,
    session: controller.model.session,
    status: controller.model.status,
    onInstall: () => {
      void controller.installModel();
    },
    onCancelInstall: () => {
      void controller.cancelInstall();
    },
    onRemove: () => {
      void controller.removeModel();
    },
    onStart: (sessionId) => {
      void controller.startSession(sessionId);
    },
    onStop: (sessionId) => {
      void controller.stopSession(sessionId);
    },
  };
}

function watchMediaJobSession(
  controller: ReturnType<typeof useMediaJobsController>,
  refreshActivity: () => Promise<void>,
): WatchDownloadSession {
  return {
    busy: controller.model.busy,
    jobs: controller.model.jobs,
    status: controller.model.status,
    onCommand: (command, jobId) => {
      void controller.apply(command, jobId).then(() => {
        void refreshActivity();
      });
    },
    onDelete: (jobId) => {
      void controller.deleteJob(jobId).then(() => {
        void refreshActivity();
      });
    },
    onExport: (jobId) => {
      void controller.exportJob(jobId);
    },
    onOpenArtifact: (jobId) => {
      void controller.openArtifact(jobId);
    },
    onStartIntent: async (intent, requestHeaders) => {
      await controller.startWithIntent(intent, requestHeaders);
      await refreshActivity();
    },
  };
}

function watchMediaJobIdFor(
  location: ShellLocation,
  peek: WatchPeek,
): string | null {
  const target = watchTargetFor(location, peek);
  if (!target) return null;
  return watchRecordingJobId(target) ?? watchDownloadJobId(target);
}

function watchTargetFor(
  location: ShellLocation,
  peek: WatchPeek,
): WatchTarget | null {
  if (
    location.route === "watch/session-preview" &&
    location.target.kind === "channel"
  ) {
    return watchTargetFromLocation(location.target);
  }
  if (location.route === "watch" && peek.kind === "active") {
    return peek.state.target;
  }
  return null;
}

async function openStartedJob(
  start: () => Promise<string>,
  activity: ReturnType<typeof useActivityController>,
  dispatch: (action: ShellNavigationAction) => void,
): Promise<void> {
  const jobId = await start();
  if (!jobId) return;
  dispatch({
    type: "navigate",
    location: { route: "activity/job-preview", jobId },
  });
  void activity.refresh();
}

function NestedRouteState({ location }: { readonly location: ShellLocation }) {
  const route = SHELL_ROUTES[location.route];
  const detail =
    location.route === "watch/session-preview" &&
    location.target.kind === "channel"
      ? `${location.target.platform.toUpperCase()} channel ${location.target.channelLogin}. Playback did not restart automatically.`
      : location.route === "activity/job-preview"
        ? `Saved media job ${location.jobId}.`
        : `${SHELL_ROUTES[route.destination].title} keeps this detail open while you visit another destination.`;
  return (
    <View accessible style={styles.statePanel}>
      <Text selectable style={styles.stateLabel}>
        SAVED PLACE
      </Text>
      <Text selectable style={styles.cardBody}>
        {detail}
      </Text>
    </View>
  );
}

const moreDestinationDescriptions = {
  "more/categories": "Browse live streams by category.",
  "more/history": "Pick up where you left off.",
  "more/downloads": "Saved videos, clips, and recordings.",
  "more/moderation": "Manage your channels and communities.",
  "more/multistream": "Watch several live streams together.",
  "more/accounts": "Connect Twitch and Kick.",
  "more/settings": "Appearance, playback, chat, and notifications.",
  "more/diagnostics": "Device checks, logs, and recovery.",
} satisfies Record<(typeof MORE_ROUTE_IDS)[number], string>;

function MoreMenu({
  dispatch,
}: {
  readonly dispatch: (action: ShellNavigationAction) => void;
}) {
  return (
    <View accessibilityLabel="More destinations" style={styles.menu}>
      {MORE_ROUTE_IDS.map((routeId) => {
        const route = SHELL_ROUTES[routeId];
        return (
          <MobileListRow
            hint={`Opens ${route.title} inside More`}
            title={route.title}
            description={moreDestinationDescriptions[routeId]}
            key={route.id}
            onPress={() =>
              dispatch({ type: "navigate", location: { route: routeId } })
            }
            testID={`open-${route.reviewId}`}
            leading={
              <MoreRouteIcon
                color={mobileColors.textCategory}
                routeId={routeId}
                size={mobileSizing.icon}
              />
            }
          />
        );
      })}
    </View>
  );
}

function DevelopmentStatus({
  model,
}: {
  readonly model: DevelopmentClientViewModel;
}) {
  return (
    <View
      accessibilityLabel="Development runtime status"
      style={styles.statusPanel}
    >
      <Text selectable style={styles.stateLabel}>
        DEVELOPMENT RUNTIME
      </Text>
      <Text selectable style={styles.cardTitle}>
        {model.runtimeStatus}
      </Text>
      <Text selectable style={styles.cardBody} testID="runtime-layer-status">
        {`${model.layerStatus} ${model.nativeCapabilityStatus} ${model.providerStatus} ${model.version}`}
      </Text>
    </View>
  );
}

function PrimaryNavigation({
  activityUnreadCount,
  bottomInset = 0,
  dispatch,
  placement,
  state,
}: {
  readonly activityUnreadCount: number;
  readonly bottomInset?: number;
  readonly dispatch: (action: ShellNavigationAction) => void;
  readonly placement: "bottom" | "rail";
  readonly state: ShellNavigationState;
}) {
  const { t } = useTranslation();
  const destinationLabel = (id: (typeof SHELL_DESTINATIONS)[number]["id"]) =>
    t(`navigation.${id === "watch" ? "home" : id}`);
  const measurementActive = useRef(true);
  const [layout, setLayout] = useState<CompactNavigationLayout>("row");

  useEffect(() => {
    measurementActive.current = true;
    return () => {
      measurementActive.current = false;
    };
  }, []);

  const onTextLayout = useCallback(
    (measuredLayout: CompactNavigationLayout) =>
      (event: NativeSyntheticEvent<TextLayoutEventData>) => {
        if (!measurementActive.current) return;
        const lineCount = event.nativeEvent.lines.length;
        setLayout((current) =>
          applyCompactNavigationTextMeasurement(current, {
            layout: measuredLayout,
            lineCount,
          }),
        );
      },
    [],
  );

  return (
    <View
      accessibilityLabel="Primary navigation"
      accessibilityRole="tablist"
      style={[
        placement === "rail" ? styles.navigationRail : styles.navigationBottom,
        placement === "bottom" && layout !== "row"
          ? styles.navigationBottomGrid
          : null,
        // Extend the bar background through the system inset; icons stay above.
        placement === "bottom" ? { paddingBottom: bottomInset } : null,
      ]}
      testID={`navigation-${placement}`}
    >
      {SHELL_DESTINATIONS.map((destination) => {
        const selected = destination.id === state.activeDestination;
        const color = selected
          ? mobileColors.textPrimary
          : mobileColors.textSecondary;
        return (
          <Pressable
            accessibilityHint={`Opens the ${destinationLabel(destination.id)} main screen`}
            accessibilityLabel={
              destination.id === "activity" && activityUnreadCount > 0
                ? `${destinationLabel(destination.id)}, ${activityUnreadCount} unread`
                : destinationLabel(destination.id)
            }
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            android_ripple={{
              color: mobileColors.surfaceRaised,
              borderless: false,
            }}
            key={destination.id}
            onPress={() =>
              dispatch({ type: "select", destination: destination.id })
            }
            style={({ pressed }) => [
              styles.navigationItem,
              placement === "rail" ? styles.navigationItemRail : null,
              placement === "bottom" && layout === "grid-3"
                ? styles.navigationItemGridThree
                : null,
              placement === "bottom" && layout === "grid-2"
                ? styles.navigationItemGridTwo
                : null,
              pressed ? styles.pressed : null,
            ]}
            testID={`nav-${destination.id}`}
          >
            <View
              style={[
                styles.navigationIcon,
                selected ? styles.navigationIconSelected : null,
              ]}
            >
              <DestinationIcon
                color={color}
                destination={destination.id}
                selected={selected}
                unreadCount={
                  destination.id === "activity" ? activityUnreadCount : 0
                }
              />
            </View>
            <Text
              onTextLayout={
                placement === "bottom" ? onTextLayout(layout) : undefined
              }
              selectable
              style={[
                styles.navigationLabel,
                { color },
                selected ? styles.navigationLabelSelected : null,
              ]}
            >
              {destinationLabel(destination.id)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    // Match Android system chrome / tab surface so letterboxed or under-nav
    // strips are continuous with PrimaryNavigation (not foreign #0f0f0f).
    backgroundColor: mobileColors.surface,
    flex: 1,
  },
  safeFrame: {
    backgroundColor: mobileColors.surface,
    flex: 1,
  },
  phoneLayout: {
    flex: 1,
  },
  railLayout: {
    flex: 1,
    flexDirection: "row",
  },
  workspace: {
    flex: 1,
    minWidth: 0,
  },
  activityWorkspace: {
    backgroundColor: mobileColors.background,
    flex: 1,
  },
  restorationNotice: {
    backgroundColor: mobileColors.surfaceMuted,
    borderBottomColor: mobileColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  header: {
    alignItems: "center",
    borderBottomColor: mobileColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 64,
    paddingHorizontal: mobileSpacing.medium,
  },
  headerTrailing: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
  },
  headerTitle: {
    flex: 1,
    gap: mobileSpacing.xSmall,
    paddingHorizontal: mobileSpacing.small,
  },
  headerText: {
    ...mobileType.display,
  },
  screenContent: {
    alignItems: "center",
    flexGrow: 1,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  screenScroll: {
    backgroundColor: mobileColors.background,
    flex: 1,
    minHeight: 0,
  },
  contentColumn: {
    gap: mobileSpacing.large,
    maxWidth: mobileSizing.readableContentMaximum,
    width: "100%",
  },
  intro: {
    gap: mobileSpacing.small,
    paddingTop: mobileSpacing.small,
  },
  screenTitle: {
    ...mobileType.display,
  },
  screenSummary: {
    ...mobileType.body,
  },
  card: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.medium,
    minHeight: 96,
    padding: mobileSpacing.medium,
  },
  cardCopy: {
    flex: 1,
    gap: mobileSpacing.small,
  },
  cardTitle: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  cardBody: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
  pressed: {
    opacity: 0.76,
  },
  proofButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  proofButtonLabel: {
    color: mobileColors.background,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  statePanel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.large,
  },
  stateLabel: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
  menu: {
    gap: mobileSpacing.small,
  },
  statusPanel: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.large,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  navigationBottom: {
    alignItems: "stretch",
    backgroundColor: mobileColors.surface,
    borderTopColor: mobileColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
    justifyContent: "space-evenly",
    minHeight: 72,
    paddingHorizontal: mobileSpacing.xSmall,
    paddingTop: mobileSpacing.xSmall,
  },
  navigationBottomGrid: {
    flexWrap: "wrap",
    gap: 0,
    justifyContent: "flex-start",
  },
  navigationRail: {
    alignItems: "stretch",
    backgroundColor: mobileColors.surface,
    borderRightColor: mobileColors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: mobileSpacing.small,
    padding: mobileSpacing.small,
    paddingTop: mobileSpacing.medium,
    width: mobileSizing.navigationRailWidth,
  },
  navigationItem: {
    alignItems: "center",
    borderRadius: mobileRadii.medium,
    flex: 1,
    gap: mobileSpacing.xSmall,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.xSmall,
    paddingVertical: mobileSpacing.xSmall,
  },
  navigationItemRail: {
    flex: 0,
    minHeight: 56,
    width: "100%",
  },
  navigationItemGridThree: {
    flex: 0,
    width: "33.333333%",
  },
  navigationItemGridTwo: {
    flex: 0,
    width: "50%",
  },
  navigationLabel: {
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 14,
    textAlign: "center",
  },
  navigationLabelSelected: { fontWeight: "700" },
  navigationIcon: {
    alignItems: "center",
    justifyContent: "center",
    width: 56,
    height: 36,
    borderRadius: 18,
    overflow: "hidden",
  },
  navigationIconSelected: { backgroundColor: mobileColors.navigationSelected },
});
