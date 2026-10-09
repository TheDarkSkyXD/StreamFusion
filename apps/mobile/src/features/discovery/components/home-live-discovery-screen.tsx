import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Stream } from "@streamfusion/core/content";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import { MobileRefreshableFlatList } from "@mobile/design/refreshable";
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

type HomeStreamRowProps = {
  readonly stream: Stream;
  readonly onSelectStream?: ((stream: Stream) => void) | undefined;
  readonly onOpenChannel?: ((channel: ChannelIdentity) => void) | undefined;
};

const HomeStreamRow = memo(function HomeStreamRow({
  stream,
  onSelectStream,
  onOpenChannel,
}: HomeStreamRowProps) {
  const onOpen = () => {
    if (onSelectStream) {
      onSelectStream(stream);
      return;
    }
    onOpenChannel?.(channelFromStream(stream));
  };
  return <HomeStreamCard onOpen={onOpen} stream={stream} />;
});

function homeStreamKey(stream: Stream): string {
  return `${stream.platform}:${stream.id}`;
}

function HomeStreamSeparator() {
  return <View style={styles.rowGap} />;
}

export function HomeLiveDiscoveryScreen({
  carouselSeconds = 15,
  footer,
  onOpenAccounts,
  onOpenChannel,
  onSelectStream,
  session,
  showTitle = true,
  title = "Home",
  topShelf,
}: {
  readonly carouselSeconds?: number;
  readonly footer?: ReactNode;
  readonly onOpenAccounts: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onSelectStream?: (stream: Stream) => void;
  readonly session: DiscoverySession;
  readonly showTitle?: boolean;
  readonly title?: string;
  readonly topShelf?: ReactNode;
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
  const [carouselIdentity, setCarouselIdentity] = useState(featuredIdentity);
  if (featuredIdentity !== carouselIdentity) {
    setCarouselIdentity(featuredIdentity);
    setFeaturedIndex(0);
  }

  useEffect(() => {
    if (featured.length < 2) return;
    const timer = setInterval(() => {
      setFeaturedIndex((current) =>
        current >= featured.length - 1 ? 0 : current + 1,
      );
    }, carouselSeconds * 1000);
    return () => clearInterval(timer);
  }, [featured.length, featuredIdentity, carouselSeconds]);

  return (
    <HomeLiveDiscoveryView
      featuredIndex={featuredIndex}
      onFeaturedIndexChange={setFeaturedIndex}
      onOpenAccounts={onOpenAccounts}
      onRefresh={live.refresh}
      refreshing={live.refreshing}
      view={live.view}
      {...(footer === undefined ? {} : { footer })}
      {...(onOpenChannel === undefined ? {} : { onOpenChannel })}
      {...(onSelectStream === undefined ? {} : { onSelectStream })}
      showTitle={showTitle}
      {...(title === undefined ? {} : { title })}
      {...(topShelf === undefined ? {} : { topShelf })}
    />
  );
}

export function HomeLiveDiscoveryView({
  featuredIndex = 0,
  footer,
  onFeaturedIndexChange,
  onOpenAccounts,
  onOpenChannel,
  onRefresh,
  onSelectProofMode,
  onSelectStream,
  proofMode,
  refreshing = false,
  showTitle = true,
  title = "Home",
  topShelf,
  view,
}: {
  readonly featuredIndex?: number;
  readonly footer?: ReactNode;
  readonly onFeaturedIndexChange?: (index: number) => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly onSelectStream?: (stream: Stream) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly refreshing?: boolean;
  readonly showTitle?: boolean;
  readonly title?: string;
  readonly topShelf?: ReactNode;
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
  const rows = featured.length > 0 ? recommended : view.streams;
  const phase = (
    <Text selectable style={mobileType.body} testID="home-phase">
      {phaseCopy(view)}
    </Text>
  );
  return (
    <MobileRefreshableFlatList<Stream>
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      data={rows}
      initialNumToRender={3}
      ItemSeparatorComponent={HomeStreamSeparator}
      keyExtractor={homeStreamKey}
      ListFooterComponent={
        footer == null ? null : (
          <View style={rows.length > 0 ? styles.footerAfterRows : undefined}>
            {footer}
          </View>
        )
      }
      ListHeaderComponent={
        <View
          style={[
            styles.header,
            rows.length > 0 || footer != null
              ? styles.headerBeforeContent
              : null,
          ]}
        >
          {showTitle ? <MobileScreenHeader title={title} /> : null}
          {topShelf ?? null}
          {featured.length > 0 ? (
            <HomeFeaturedCarouselView
              activeIndex={featuredIndex}
              onSelectIndex={(index) => onFeaturedIndexChange?.(index)}
              onWatch={openStream}
              streams={featured}
            />
          ) : null}
          <Text selectable style={mobileType.title}>
            Live Channels
          </Text>
          {view.phase === "empty" || view.phase === "failed" ? (
            <MobileStatusPanel
              tone={view.phase === "failed" ? "error" : "empty"}
            >
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
            outcome={view.providers.twitch}
          />
          <HomeProviderBanner
            onOpenAccounts={onOpenAccounts}
            outcome={view.providers.kick}
          />
        </View>
      }
      maxToRenderPerBatch={3}
      onRefresh={onRefresh}
      refreshing={refreshing}
      renderItem={({ item }) => (
        <HomeStreamRow
          onOpenChannel={onOpenChannel}
          onSelectStream={onSelectStream}
          stream={item}
        />
      )}
      style={styles.scroll}
      testID="home-live-discovery"
      windowSize={5}
    />
  );
}

function phaseCopy(view: HomeLiveDiscoveryModel): string {
  switch (view.phase) {
    case "loading":
      return "Loading live channels…";
    case "ready":
      return "Live across Twitch and Kick.";
    case "offline-cache":
      return "Cached live channels — connection limited.";
    case "empty":
      return "No live channels right now.";
    case "failed":
      return "Couldn’t load live channels.";
  }
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  content: {
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  header: {
    gap: mobileSpacing.medium,
  },
  headerBeforeContent: {
    marginBottom: mobileSpacing.medium,
  },
  rowGap: {
    height: mobileSpacing.medium,
  },
  footerAfterRows: {
    marginTop: mobileSpacing.medium,
  },
});
