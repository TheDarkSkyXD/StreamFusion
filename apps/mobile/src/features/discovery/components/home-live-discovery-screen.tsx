import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  DiscoveryFixtureMode,
  DiscoverySession,
  HomeLiveDiscoveryView as HomeLiveDiscoveryModel,
} from "../capabilities/platform-reads";
import { channelFromStream } from "../domain/channel-detail";
import { fixtureOutcome } from "../domain/discovery-fixture";
import { composeHomeLiveDiscovery } from "../domain/home-live-discovery";

import { HomeDiscoveryProofControls } from "./home-discovery-proof-controls";
import { HomeProviderBanner } from "./home-provider-banner";
import { HomeStreamCard } from "./home-stream-card";
import { useHomeLiveDiscovery } from "./use-home-live-discovery";

export function HomeLiveDiscoveryScreen({
  onOpenCategories,
  onOpenChannel,
  session,
}: {
  readonly onOpenCategories: () => void;
  readonly onOpenChannel: (channel: ChannelIdentity) => void;
  readonly session: DiscoverySession;
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
      onOpenCategories={onOpenCategories}
      onOpenChannel={onOpenChannel}
      onRetry={live.retry}
      view={view}
      {...(__DEV__ ? { onSelectProofMode: setMode, proofMode: mode } : {})}
    />
  );
}

export function HomeLiveDiscoveryView({
  onOpenCategories,
  onOpenChannel,
  onRetry,
  onSelectProofMode,
  proofMode,
  view,
}: {
  readonly onOpenCategories: () => void;
  readonly onOpenChannel: (channel: ChannelIdentity) => void;
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
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" selectable style={styles.title}>
          Home
        </Text>
        <Pressable
          accessibilityHint="Opens categories"
          accessibilityLabel="Categories"
          accessibilityRole="button"
          android_ripple={{ color: mobileColors.surfaceRaised }}
          onPress={onOpenCategories}
          style={({ pressed }) => [
            styles.categories,
            pressed ? styles.pressed : null,
          ]}
          testID="home-categories"
        >
          <Text selectable style={styles.categoriesLabel}>
            Categories
          </Text>
        </Pressable>
      </View>
      <Text selectable style={styles.heading}>
        Recommended live
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
      <HomeProviderBanner onRetry={onRetry} outcome={view.providers.twitch} />
      <HomeProviderBanner onRetry={onRetry} outcome={view.providers.kick} />
      {view.streams.map((stream) => (
        <HomeStreamCard
          key={`${stream.platform}:${stream.id}`}
          onOpen={() => onOpenChannel(channelFromStream(stream))}
          stream={stream}
        />
      ))}
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
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  categories: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  categoriesLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  heading: {
    color: mobileColors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  summary: {
    color: mobileColors.textCategory,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
  },
  pressed: {
    opacity: 0.76,
  },
});
