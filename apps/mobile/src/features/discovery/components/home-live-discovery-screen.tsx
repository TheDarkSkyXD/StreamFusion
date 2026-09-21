import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import type { Stream } from "@streamfusion/core/content";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

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
import {
  featuredCarouselStreams,
  HomeFeaturedCarouselView,
  recommendedLiveStreams,
} from "./home-featured-carousel";
import { HomeProviderBanner } from "./home-provider-banner";
import { HomeStreamCard } from "./home-stream-card";
import { useHomeLiveDiscovery } from "./use-home-live-discovery";

/** Match Electron HOME_CAROUSEL_INTERVAL_DEFAULT_MS (15s). */
const HOME_FEATURED_ROTATE_MS = 15_000;

export function HomeLiveDiscoveryScreen({
  footer,
  onOpenAccounts,
  onOpenChannel,
  onSelectStream,
  session,
  title = "Home",
}: {
  readonly footer?: ReactNode;
  readonly onOpenAccounts: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onSelectStream?: (stream: Stream) => void;
  readonly session: DiscoverySession;
  readonly title?: string;
}) {
  const live = useHomeLiveDiscovery({ session });
  const featured = useMemo(
    () => featuredCarouselStreams(live.view.streams),
    [live.view.streams],
  );
  const featuredIdentity = useMemo(
    () => featured.map((stream) => `${stream.platform}:${stream.id}`).join("|"),
    [featured],
  );
  const [featuredIndex, setFeaturedIndex] = useState(0);

  useEffect(() => {
    setFeaturedIndex(0);
  }, [featuredIdentity]);

  useEffect(() => {
    if (featured.length < 2) return;
    const timer = setInterval(() => {
      setFeaturedIndex((current) =>
        current >= featured.length - 1 ? 0 : current + 1,
      );
    }, HOME_FEATURED_ROTATE_MS);
    return () => clearInterval(timer);
  }, [featured.length, featuredIdentity]);

  return (
    <HomeLiveDiscoveryView
      featuredIndex={featuredIndex}
      onFeaturedIndexChange={setFeaturedIndex}
      onOpenAccounts={onOpenAccounts}
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
  featuredIndex = 0,
  footer,
  onFeaturedIndexChange,
  onOpenAccounts,
  onOpenChannel,
  onRetry,
  onSelectProofMode,
  onSelectStream,
  proofMode,
  title = "Home",
  view,
}: {
  readonly featuredIndex?: number;
  readonly footer?: ReactNode;
  readonly onFeaturedIndexChange?: (index: number) => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onRetry: (platform: Platform) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly onSelectStream?: (stream: Stream) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly title?: string;
  readonly view: HomeLiveDiscoveryModel;
}) {
  const featured = featuredCarouselStreams(view.streams);
  const recommended = recommendedLiveStreams(view.streams);
  const openStream = (stream: Stream) => {
    if (onSelectStream) {
      onSelectStream(stream);
      return;
    }
    onOpenChannel?.(channelFromStream(stream));
  };
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
      <MobileScreenHeader title={title} />
      {featured.length > 0 ? (
        <HomeFeaturedCarouselView
          activeIndex={featuredIndex}
          onSelectIndex={(index) => onFeaturedIndexChange?.(index)}
          onWatch={openStream}
          streams={featured}
        />
      ) : null}
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
      {(featured.length > 0 ? recommended : view.streams).map((stream) => (
        <HomeStreamCard
          key={`${stream.platform}:${stream.id}`}
          onOpen={() => openStream(stream)}
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
