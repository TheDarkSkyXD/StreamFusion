import { memo, type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { Stream } from "@streamfusion/core/content";
import type { ChannelIdentity } from "@streamfusion/core/platform";
import type { Platform } from "@streamfusion/core/platform";

import { MobileButton } from "@mobile/design/button";
import { MobileRefreshableFlatList } from "@mobile/design/refreshable";
import { MobileScreenHeader } from "@mobile/design/screen-header";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileColors, mobileSpacing, mobileType } from "@mobile/design/tokens";
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
  footer,
  language,
  onOpenAccounts,
  onOpenChannel,
  onSelectStream,
  session,
  showTitle = true,
  title = "Watch",
  topShelf,
}: {
  readonly footer?: ReactNode;
  readonly language?: string;
  readonly onOpenAccounts: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onSelectStream?: (stream: Stream) => void;
  readonly session: DiscoverySession;
  readonly showTitle?: boolean;
  readonly title?: string;
  readonly topShelf?: ReactNode;
}) {
  const live = useHomeLiveDiscovery({
    session,
    ...(language === undefined ? {} : { language }),
  });
  return (
    <HomeLiveDiscoveryView
      canLoadMore={live.canLoadMore}
      loadingMore={live.loadingMore}
      onOpenAccounts={onOpenAccounts}
      onLoadMore={live.loadMore}
      onRefresh={live.refresh}
      onRetryPage={live.retryPage}
      pageErrors={live.pageErrors}
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
  canLoadMore = false,
  footer,
  loadingMore = false,
  onLoadMore,
  onOpenAccounts,
  onOpenChannel,
  onRefresh,
  onRetryPage,
  onSelectProofMode,
  onSelectStream,
  proofMode,
  pageErrors,
  refreshing = false,
  showTitle = true,
  title = "Watch",
  topShelf,
  view,
}: {
  readonly canLoadMore?: boolean;
  readonly footer?: ReactNode;
  readonly loadingMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly onOpenAccounts: () => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly onRetryPage?: (platform: Platform) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly onSelectStream?: (stream: Stream) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly pageErrors?: Readonly<Record<Platform, boolean>>;
  readonly refreshing?: boolean;
  readonly showTitle?: boolean;
  readonly title?: string;
  readonly topShelf?: ReactNode;
  readonly view: HomeLiveDiscoveryModel;
}) {
  const rows = view.streams;
  const phase = view.phase === "loading" ? (
    <ActivityIndicator
      accessibilityLabel="Loading live channels"
      accessibilityRole="progressbar"
      color={mobileColors.textSecondary}
      size="large"
      style={styles.loading}
      testID="home-loading-spinner"
    />
  ) : (
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
        footer == null && !loadingMore && !canLoadMore &&
        !pageErrors?.twitch && !pageErrors?.kick ? null : (
          <View style={rows.length > 0 ? styles.footerAfterRows : undefined}>
            {footer}
            {loadingMore ? (
              <ActivityIndicator
                accessibilityLabel="Loading more live channels"
                accessibilityRole="progressbar"
                color={mobileColors.textSecondary}
                testID="home-loading-more"
              />
            ) : null}
            {canLoadMore && onLoadMore ? (
              <MobileButton
                accessibilityLabel="Load more live channels"
                onPress={onLoadMore}
                testID="home-load-more"
                variant="secondary"
              >
                Load more live channels
              </MobileButton>
            ) : null}
            {(["twitch", "kick"] as const).map((platform) =>
              pageErrors?.[platform] && onRetryPage ? (
                <MobileButton
                  accessibilityLabel={`Retry ${platform === "twitch" ? "Twitch" : "Kick"} live channels`}
                  key={platform}
                  onPress={() => onRetryPage(platform)}
                  testID={`home-load-more-retry-${platform}`}
                  variant="secondary"
                >
                  {`Retry ${platform === "twitch" ? "Twitch" : "Kick"} live channels`}
                </MobileButton>
              ) : null,
            )}
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
      onEndReached={() => {
        if (canLoadMore) onLoadMore?.();
      }}
      onEndReachedThreshold={0.5}
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
  loading: {
    alignSelf: "center",
    paddingVertical: mobileSpacing.large,
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
