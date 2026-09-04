import { ArrowLeft, ChevronRight, CircleUserRound } from "lucide-react-native";
import { StatusBar } from "expo-status-bar";
import { useEffect, useReducer, useRef } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { DevelopmentClientViewModel } from "@mobile/features/development/development-client-controller";

import { DestinationIcon } from "./destination-icon";
import {
  canNavigateBack,
  createInitialShellNavigationState,
  getActiveShellRoute,
  getShellNavigationPlacement,
  MORE_ROUTE_IDS,
  SHELL_DESTINATIONS,
  SHELL_ROUTES,
  shellNavigationReducer,
  type ShellDestination,
  type ShellNavigationAction,
  type ShellNavigationState,
  type ShellRouteId,
} from "./shell-navigation";

const previewRoutes: Readonly<
  Partial<Record<ShellDestination["id"], ShellRouteId>>
> = {
  search: "search/result-preview",
  following: "following/channel-preview",
  watch: "watch/session-preview",
  activity: "activity/alert-preview",
};

export function AppShell({
  developmentStatus,
}: {
  readonly developmentStatus: DevelopmentClientViewModel;
}) {
  const [navigation, dispatch] = useReducer(
    shellNavigationReducer,
    undefined,
    createInitialShellNavigationState,
  );
  const { width } = useWindowDimensions();
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
  }, [navigation]);

  const navigationView = (
    <PrimaryNavigation
      dispatch={dispatch}
      placement={placement}
      state={navigation}
    />
  );

  return (
    <KeyboardAvoidingView
      style={styles.app}
      testID="development-client-ready"
    >
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
        <View style={placement === "rail" ? styles.railLayout : styles.phoneLayout}>
          {placement === "rail" ? navigationView : null}
          <View style={styles.workspace}>
            <ShellHeader dispatch={dispatch} state={navigation} />
            <ShellScreen
              developmentStatus={developmentStatus}
              dispatch={dispatch}
              state={navigation}
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
          android_ripple={{ color: mobileColors.surfaceRaised, borderless: true }}
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
        accessibilityHint="Opens Accounts and maintenance under More"
        accessibilityLabel="Accounts and maintenance"
        accessibilityRole="button"
        android_ripple={{ color: mobileColors.surfaceRaised, borderless: true }}
        onPress={() => dispatch({ type: "navigate", route: "more/accounts" })}
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
  developmentStatus,
  dispatch,
  state,
}: {
  readonly developmentStatus: DevelopmentClientViewModel;
  readonly dispatch: (action: ShellNavigationAction) => void;
  readonly state: ShellNavigationState;
}) {
  const route = getActiveShellRoute(state);
  const scrollView = useRef<ScrollView>(null);
  const scrollRequest = state.rootScrollRequests[state.activeDestination];

  useEffect(() => {
    scrollView.current?.scrollTo({ animated: false, y: 0 });
  }, [scrollRequest]);

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      contentInsetAdjustmentBehavior="automatic"
      ref={scrollView}
      testID={`screen-${route.reviewId}`}
    >
      <View style={styles.contentColumn}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" selectable style={styles.screenTitle}>
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
          <NestedRouteState destination={state.activeDestination} />
        )}
        {route.id === "more/diagnostics" ? (
          <DevelopmentStatus model={developmentStatus} />
        ) : null}
      </View>
    </ScrollView>
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
  const targetRoute = SHELL_ROUTES[target];
  return (
    <Pressable
      accessibilityHint={`Opens ${targetRoute.title} inside ${SHELL_ROUTES[destination].title}`}
      accessibilityLabel={`Open ${targetRoute.title}`}
      accessibilityRole="button"
      android_ripple={{ color: mobileColors.surfaceRaised }}
      onPress={() => dispatch({ type: "navigate", route: target })}
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

function NestedRouteState({
  destination,
}: {
  readonly destination: ShellDestination["id"];
}) {
  return (
    <View accessible style={styles.statePanel}>
      <Text selectable style={styles.stateLabel}>
        SAVED PLACE
      </Text>
      <Text selectable style={styles.cardBody}>
        {`${SHELL_ROUTES[destination].title} keeps this detail open while you visit another destination.`}
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
            onPress={() => dispatch({ type: "navigate", route: route.id })}
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
    <View accessibilityLabel="Development runtime status" style={styles.statusPanel}>
      <Text selectable style={styles.stateLabel}>
        DEVELOPMENT RUNTIME
      </Text>
      <Text selectable style={styles.cardTitle}>
        {model.runtimeStatus}
      </Text>
      <Text selectable style={styles.cardBody} testID="runtime-layer-status">
        {`${model.layerStatus} ${model.providerStatus} ${model.version}`}
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
  return (
    <View
      accessibilityLabel="Primary navigation"
      accessibilityRole="tablist"
      style={placement === "rail" ? styles.navigationRail : styles.navigationBottom}
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
            android_ripple={{ color: mobileColors.surfaceRaised, borderless: false }}
            key={destination.id}
            onPress={() =>
              dispatch({ type: "select", destination: destination.id })
            }
            style={({ pressed }) => [
              styles.navigationItem,
              placement === "rail" ? styles.navigationItemRail : null,
              selected ? styles.navigationItemSelected : null,
              pressed ? styles.pressed : null,
            ]}
            testID={`nav-${destination.id}`}
          >
            <DestinationIcon color={color} destination={destination.id} />
            <Text selectable style={[styles.navigationLabel, { color }]}>
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
