import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  DiscoveryFixtureMode,
  HomeDiscoverySession,
  HomeLiveDiscoveryView as HomeLiveDiscoveryModel,
} from "../capabilities/platform-reads";
import { fixtureOutcome } from "../domain/discovery-fixture";
import { composeHomeLiveDiscovery } from "../domain/home-live-discovery";

import { HomeDiscoveryProofControls } from "./home-discovery-proof-controls";
import { HomeProviderBanner } from "./home-provider-banner";
import { HomeStreamCard } from "./home-stream-card";
import { useHomeLiveDiscovery } from "./use-home-live-discovery";

export function HomeLiveDiscoveryScreen({
  onOpenAccounts,
  session,
}: {
  readonly onOpenAccounts: () => void;
  readonly session: HomeDiscoverySession;
}) {
  const [mode, setMode] = useState<DiscoveryFixtureMode>("live");
  const live = useHomeLiveDiscovery({
    enabled: mode === "live",
    session,
  });
  const view =
    mode === "live"
      ? live.view
      : composeHomeLiveDiscovery({
          kick: fixtureOutcome("kick", mode),
          loading: mode === "loading",
          twitch: fixtureOutcome("twitch", mode),
        });
  return (
    <HomeLiveDiscoveryView
      onOpenAccounts={onOpenAccounts}
      onRetry={live.retry}
      view={view}
      {...(__DEV__
        ? { onSelectProofMode: setMode, proofMode: mode }
        : {})}
    />
  );
}

export function HomeLiveDiscoveryView({
  onOpenAccounts,
  onRetry,
  onSelectProofMode,
  proofMode,
  view,
}: {
  readonly onOpenAccounts: () => void;
  readonly onRetry: (platform: Platform) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly view: HomeLiveDiscoveryModel;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="home-live-discovery"
    >
      <Text accessibilityRole="header" selectable style={styles.title}>
        Home
      </Text>
      <Text selectable style={styles.summary} testID="home-phase">
        {phaseCopy(view)}
      </Text>
      {proofMode && onSelectProofMode ? (
        <HomeDiscoveryProofControls
          mode={proofMode}
          onSelect={onSelectProofMode}
        />
      ) : null}
      <HomeProviderBanner
        onOpenAccounts={onOpenAccounts}
        onRetry={onRetry}
        outcome={view.providers.twitch}
      />
      <HomeProviderBanner
        onOpenAccounts={onOpenAccounts}
        onRetry={onRetry}
        outcome={view.providers.kick}
      />
      {view.streams.map((stream) => (
        <HomeStreamCard key={`${stream.platform}:${stream.id}`} stream={stream} />
      ))}
      {needsLogin(view) ? (
        <Pressable
          accessibilityHint="Opens Accounts so you can sign in"
          accessibilityLabel="Sign in"
          accessibilityRole="button"
          android_ripple={{ color: mobileColors.surfaceRaised }}
          onPress={onOpenAccounts}
          style={({ pressed }) => [
            styles.login,
            pressed ? styles.pressed : null,
          ]}
          testID="home-login"
        >
          <Text selectable style={styles.loginLabel}>
            Sign in
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function phaseCopy(view: HomeLiveDiscoveryModel): string {
  switch (view.phase) {
    case "loading":
      return "Loading live recommendations from Twitch and Kick.";
    case "ready":
      return "Live recommendations from Twitch and Kick.";
    case "offline-cache":
      return "Showing cached recommendations while a live read is unavailable.";
    case "empty":
      return "No live recommendations are available right now.";
    case "failed":
      return "Live recommendations could not be loaded.";
  }
}

function needsLogin(view: HomeLiveDiscoveryModel): boolean {
  return (["twitch", "kick"] as const).some((platform) => {
    const outcome = view.providers[platform];
    return (
      outcome.error?.code === "auth-lost" ||
      (outcome.path.kind === "unavailable" &&
        outcome.path.reason === "signed-out-login-required")
    );
  });
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  summary: {
    color: mobileColors.textCategory,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
  },
  login: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  loginLabel: {
    color: mobileColors.background,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  pressed: {
    opacity: 0.76,
  },
});
