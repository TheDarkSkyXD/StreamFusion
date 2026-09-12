import { ArrowLeft, ChevronRight, CircleUserRound } from "lucide-react-native";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  type NativeSyntheticEvent,
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
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import { useActivityController } from "@mobile/features/activity/components/activity-controller";
import { DevelopmentActivityProofControl } from "@mobile/features/activity/components/development-activity-proof-control";
import type { DevelopmentActivityProofViewModel } from "@mobile/features/activity/capabilities/development-activity-proof";
import {
  ActivityDetailScreen,
  ActivityScreen,
} from "@mobile/features/activity/components/activity-screen";
import type { DevelopmentClientViewModel } from "@mobile/features/diagnostics/domain/development-client-controller";
import type { PersistenceViewModel } from "@mobile/features/diagnostics/components/persistence-controller";
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
import type {
  DiscoveryRuntime,
  SearchHistoryRepository,
} from "@mobile/features/discovery/capabilities/platform-reads";
import { HomeLiveDiscoveryScreen } from "@mobile/features/discovery/components/home-live-discovery-screen";
import { UnifiedSearchScreen } from "@mobile/features/discovery/components/unified-search-screen";

import { DestinationIcon } from "./destination-icon";
import {
  applyCompactNavigationTextMeasurement,
  type CompactNavigationLayout,
} from "../domain/shell-layout";
import {
  canNavigateBack,
  getActiveShellLocation,
  getActiveShellRoute,
  getShellNavigationPlacement,
  MORE_ROUTE_IDS,
  SHELL_DESTINATIONS,
  SHELL_ROUTES,
  type ShellDestination,
  type ShellLocation,
  type ShellNavigationAction,
  type ShellNavigationState,
} from "../domain/shell-navigation";
import {
  useShellLifecycleController,
  type ShellLifecycleStatus,
} from "./shell-lifecycle-controller";

const previewRoutes: Readonly<
  Partial<Record<ShellDestination["id"], ShellLocation>>
> = {
  search: { route: "search/result-preview" },
  following: { route: "following/channel-preview" },
  watch: { route: "watch/session-preview", target: { kind: "preview" } },
};

export function AppShell({
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
  searchHistory,
}: {
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
  readonly homeDiscovery: DiscoveryRuntime;
  readonly searchHistory: SearchHistoryRepository;
}) {
  const activityRepositoryEpoch =
    developmentActivityProof?.kind === "proof" ||
    (developmentActivityProof?.kind === "cleanup-required" &&
      developmentActivityProof.selected)
      ? developmentActivityProof.namespace
      : "main";
  const activity = useActivityController({
    epoch: activityRepositoryEpoch,
    repository: activityRepository,
  });
  const lifecycle = useShellLifecycleController({
    appLinks,
    restoration: shellRestoration,
  });
  const { dispatch, state: navigation } = lifecycle;
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const placement = getShellNavigationPlacement(width);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!canNavigateBack(navigation)) {
          return false;
        }
        dispatch({ type: "back" });
        return true;
      },
    );
    return () => subscription.remove();
  }, [dispatch, navigation]);

  const navigationView = (
    <PrimaryNavigation
      dispatch={dispatch}
      key={`${placement}:${width}:${fontScale}`}
      placement={placement}
      state={navigation}
    />
  );

  return (
    <KeyboardAvoidingView style={styles.app} testID="development-client-ready">
      <View
        accessibilityLabel="StreamFusion app shell"
        style={[
          styles.safeFrame,
          {
            paddingBottom: placement === "rail" ? insets.bottom : 0,
            paddingLeft: insets.left,
            paddingRight: insets.right,
            paddingTop: insets.top,
          },
        ]}
        testID="app-shell-ready"
      >
        <View
          style={placement === "rail" ? styles.railLayout : styles.phoneLayout}
        >
          {placement === "rail" ? navigationView : null}
          <View style={styles.workspace}>
            <ShellHeader dispatch={dispatch} state={navigation} />
            <RestorationNotice
              developmentDiagnostic={
                __DEV__ ? persistenceStatus.developmentDiagnostic : null
              }
              status={lifecycle.status}
            />
            <ShellScreen
              activity={activity}
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
              onReplayDevelopmentActivityProof={onReplayDevelopmentActivityProof}
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
              kickAccount={kickAccount}
              kickAccountActions={kickAccountActions}
              kickAccountDevelopmentFixture={kickAccountDevelopmentFixture}
              onEnableKickDevelopmentFixture={onEnableKickDevelopmentFixture}
              onDisableKickDevelopmentFixture={onDisableKickDevelopmentFixture}
              onDisableTwitchDevelopmentFixture={
                onDisableTwitchDevelopmentFixture
              }
              homeDiscovery={homeDiscovery}
              searchHistory={searchHistory}
            />
          </View>
        </View>
        {placement === "bottom" ? (
          <View style={{ paddingBottom: insets.bottom }}>{navigationView}</View>
        ) : null}
      </View>
      <StatusBar style="light" />
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
  const showsBack = canNavigateBack(state);
  return (
    <View style={styles.header}>
      {showsBack ? (
        <Pressable
          accessibilityHint={`Returns to ${SHELL_ROUTES[state.activeDestination].title}`}
          accessibilityLabel="Back"
          accessibilityRole="button"
          android_ripple={{
            color: mobileColors.surfaceRaised,
            borderless: true,
          }}
          onPress={() => dispatch({ type: "back" })}
          style={styles.headerAction}
          testID="shell-back"
        >
          <ArrowLeft
            accessibilityElementsHidden
            color={mobileColors.textPrimary}
            size={mobileSizing.icon}
          />
        </Pressable>
      ) : (
        <View style={styles.headerActionSpacer} />
      )}
      <View accessible style={styles.headerTitle}>
        <Text selectable style={styles.headerEyebrow}>
          {route.eyebrow}
        </Text>
        <Text accessibilityRole="header" selectable style={styles.headerText}>
          {route.title}
        </Text>
      </View>
      <Pressable
        accessibilityHint="Opens More, including Accounts and maintenance"
        accessibilityLabel="More"
        accessibilityRole="button"
        android_ripple={{ color: mobileColors.surfaceRaised, borderless: true }}
        onPress={() =>
          dispatch({ type: "navigate", location: { route: "more" } })
        }
        style={styles.headerAction}
        testID="shell-accounts"
      >
        <CircleUserRound
          accessibilityElementsHidden
          color={mobileColors.textPrimary}
          size={mobileSizing.icon}
        />
      </Pressable>
    </View>
  );
}

function ShellScreen({
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
  searchHistory,
}: {
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
  readonly homeDiscovery: DiscoveryRuntime;
  readonly searchHistory: SearchHistoryRepository;
}) {
  const route = getActiveShellRoute(state);
  const location = getActiveShellLocation(state);
  const scrollView = useRef<ScrollView>(null);
  const scrollRequest = state.rootScrollRequests[state.activeDestination];

  useEffect(() => {
    scrollView.current?.scrollTo({ animated: false, y: 0 });
  }, [scrollRequest]);

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
          onSelectFilter={activity.selectFilter}
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

  if (location.route === "search") {
    return (
      <View style={styles.activityWorkspace} testID="screen-search-root">
        <UnifiedSearchScreen
          history={searchHistory}
          onOpenAccounts={() =>
            dispatch({ type: "navigate", location: { route: "more/accounts" } })
          }
          session={homeDiscovery}
        />
      </View>
    );
  }

  if (location.route === "more/home") {
    return (
      <View style={styles.activityWorkspace} testID="screen-more-home">
        <HomeLiveDiscoveryScreen
          onOpenAccounts={() =>
            dispatch({ type: "navigate", location: { route: "more/accounts" } })
          }
          session={homeDiscovery}
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
            onEnableDevelopmentFixture={onEnableTwitchDevelopmentFixture}
            onDisableKickDevelopmentFixture={onDisableKickDevelopmentFixture}
            onEnableKickDevelopmentFixture={onEnableKickDevelopmentFixture}
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

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      contentInsetAdjustmentBehavior="automatic"
      ref={scrollView}
      style={styles.screenScroll}
      testID={`screen-${route.reviewId}`}
    >
      <View style={styles.contentColumn}>
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
        {route.id === "more/diagnostics" ? (
          <>
            <CapabilityProfilePanel
              model={capabilityProfile}
              onRetry={onRetryCapabilityProfile}
            />
            <InstallationPolicyPanel
              model={installationPolicy}
              onRefreshCapabilityPolicy={onRefreshCapabilityPolicy}
              onRetryInstallationRegistration={onRetryInstallationRegistration}
            />
            {__DEV__ && developmentActivityProof ? (
              <DevelopmentActivityProofControl
                model={developmentActivityProof}
                onExit={onExitDevelopmentActivityProof}
                onQueueReadFailure={onQueueActivityReadFailure}
                onRefresh={activity.refresh}
                onReplay={onReplayDevelopmentActivityProof}
                onRetryCleanup={onRetryDevelopmentActivityProofCleanup}
                onStart={onStartDevelopmentActivityProof}
              />
            ) : null}
            {__DEV__ ? (
              <DevelopmentResourceFailureProofControl
                onQueue={onRunCapabilityProfileDevelopmentProof}
                onRetry={onRetryCapabilityProfile}
              />
            ) : null}
            <PersistenceStatus
              model={persistenceStatus}
              onRunProof={async () => {
                await onRunPersistenceProof();
                await activity.recordStorageCheck();
              }}
            />
            {__DEV__ ? (
              <RestorationProofControls onPrepare={onPrepareRestorationProof} />
            ) : null}
            {__DEV__ ? (
              <NativeCapabilityStubProofControl
                onRun={onRunNativeCapabilityProof}
              />
            ) : null}
            <DevelopmentStatus model={developmentStatus} />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
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
          <Pressable
            accessibilityHint={`Opens ${route.title} inside More`}
            accessibilityLabel={route.title}
            accessibilityRole="button"
            android_ripple={{ color: mobileColors.surfaceRaised }}
            key={route.id}
            onPress={() =>
              dispatch({ type: "navigate", location: { route: routeId } })
            }
            style={({ pressed }) => [
              styles.menuRow,
              pressed ? styles.pressed : null,
            ]}
            testID={`open-${route.reviewId}`}
          >
            <View style={styles.menuCopy}>
              <Text selectable style={styles.cardTitle}>
                {route.title}
              </Text>
              <Text selectable style={styles.menuSummary}>
                {route.summary}
              </Text>
            </View>
            <ChevronRight
              accessibilityElementsHidden
              color={mobileColors.textSecondary}
              size={mobileSizing.icon}
            />
          </Pressable>
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
  dispatch,
  placement,
  state,
}: {
  readonly dispatch: (action: ShellNavigationAction) => void;
  readonly placement: "bottom" | "rail";
  readonly state: ShellNavigationState;
}) {
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
            accessibilityHint={`Switches to ${destination.label} and preserves other navigation histories`}
            accessibilityLabel={destination.label}
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
              selected ? styles.navigationItemSelected : null,
              pressed ? styles.pressed : null,
            ]}
            testID={`nav-${destination.id}`}
          >
            <DestinationIcon color={color} destination={destination.id} />
            <Text
              onTextLayout={
                placement === "bottom" ? onTextLayout(layout) : undefined
              }
              selectable
              style={[styles.navigationLabel, { color }]}
            >
              {destination.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    backgroundColor: mobileColors.background,
    flex: 1,
  },
  safeFrame: {
    backgroundColor: mobileColors.background,
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
    paddingHorizontal: mobileSpacing.small,
  },
  headerAction: {
    alignItems: "center",
    borderRadius: mobileRadii.full,
    height: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    width: mobileSizing.minimumTouchTarget,
  },
  headerActionSpacer: {
    height: mobileSizing.minimumTouchTarget,
    width: mobileSizing.minimumTouchTarget,
  },
  headerTitle: {
    flex: 1,
    gap: mobileSpacing.xSmall,
    paddingHorizontal: mobileSpacing.small,
  },
  headerEyebrow: {
    color: mobileColors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    lineHeight: 14,
  },
  headerText: {
    color: mobileColors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 22,
  },
  screenContent: {
    alignItems: "center",
    flexGrow: 1,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  screenScroll: {
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
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  screenSummary: {
    color: mobileColors.textCategory,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
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
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    overflow: "hidden",
  },
  menuRow: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderBottomColor: mobileColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: mobileSpacing.medium,
    minHeight: 72,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  menuCopy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  menuSummary: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
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
  navigationItemSelected: {
    backgroundColor: mobileColors.navigationSelected,
  },
  navigationLabel: {
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 14,
    textAlign: "center",
  },
});
