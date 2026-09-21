import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import type { Stream } from "@streamfusion/core/content";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

import { MobileButton } from "@mobile/design/button";
import { MobileScreenHeader } from "@mobile/design/screen-header";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
import type {
  DiscoveryFixtureMode,
  DiscoverySession,
  HomeLiveDiscoveryView as HomeLiveDiscoveryModel,
} from "../capabilities/platform-reads";
import { channelFromStream } from "../domain/channel-detail";

import { HomeDiscoveryProofControls } from "./home-discovery-proof-controls";
import { HomeProviderBanner } from "./home-provider-banner";
import { HomeStreamCard } from "./home-stream-card";
import { useHomeLiveDiscovery } from "./use-home-live-discovery";

export function HomeLiveDiscoveryScreen({
  footer,
  onOpenAccounts,
  onOpenCategories,
  onOpenChannel,
  onSelectStream,
  session,
  title = "Home",
}: {
  readonly footer?: ReactNode;
  readonly onOpenAccounts: () => void;
  readonly onOpenCategories: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onSelectStream?: (stream: Stream) => void;
  readonly session: DiscoverySession;
  readonly title?: string;
}) {
  const live = useHomeLiveDiscovery({ session });
  return (
    <HomeLiveDiscoveryView
      onOpenAccounts={onOpenAccounts}
      onOpenCategories={onOpenCategories}
      onRetry={live.retry}
      view={live.view}
      {...(footer === undefined ? {} : { footer })}
      {...(onOpenChannel === undefined ? {} : { onOpenChannel })}
      {...(onSelectStream === undefined ? {} : { onSelectStream })}
      {...(title === undefined ? {} : { title })}
    />
  );
}

export function HomeLiveDiscoveryView({
  footer,
  onOpenAccounts,
  onOpenCategories,
  onOpenChannel,
  onRetry,
  onSelectProofMode,
  onSelectStream,
  proofMode,
  title = "Home",
  view,
}: {
  readonly footer?: ReactNode;
  readonly onOpenAccounts: () => void;
  readonly onOpenCategories: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onRetry: (platform: Platform) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly onSelectStream?: (stream: Stream) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly title?: string;
  readonly view: HomeLiveDiscoveryModel;
}) {
  const phase = (
    <Text selectable style={mobileType.body} testID="home-phase">
      {phaseCopy(view)}
    </Text>
  );
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="home-live-discovery"
    >
      <MobileScreenHeader
        action={
          <MobileButton
            accessibilityHint="Opens categories"
            accessibilityLabel="Categories"
            onPress={onOpenCategories}
            testID="home-categories"
            variant="secondary"
          >
            Categories
          </MobileButton>
        }
        title={title}
      />
      <Text selectable style={mobileType.title}>
        Recommended live
      </Text>
      {view.phase === "empty" || view.phase === "failed" ? (
        <MobileStatusPanel tone={view.phase === "failed" ? "error" : "empty"}>
          {phase}
        </MobileStatusPanel>
      ) : (
        phase
      )}
      <MobileButton
        accessibilityHint="Opens Categories inside More"
        accessibilityLabel="Open Categories"
        onPress={onOpenCategories}
        testID="open-categories"
        variant="primary"
      >
        Categories
      </MobileButton>
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
        <HomeStreamCard
          key={`${stream.platform}:${stream.id}`}
          onOpen={() => {
            if (onSelectStream) {
              onSelectStream(stream);
              return;
            }
            onOpenChannel?.(channelFromStream(stream));
          }}
          stream={stream}
        />
      ))}
      {footer ?? null}
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
});
