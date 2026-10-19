import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useCallback } from "react";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import type { Platform } from "@streamfusion/core/platform";

import { MobileUnderlineTabs } from "@mobile/design/underline-tabs";
import { MobileButton } from "@mobile/design/button";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { DiscoveryFixtureMode } from "../capabilities/platform-reads";
import type { CategoryDetailView as CategoryDetailModel } from "../domain/category-detail";
import type { CategoryMediaItem } from "../domain/category-detail";
import {
  watchTargetFromClip,
  watchTargetFromStream,
  watchTargetFromVideo,
} from "../domain/channel-watch-target";
import {
  categoryIdForPlatform,
  defaultCategoryRequest,
  platformsForScope,
  type CategoryRequestIdentity,
} from "../domain/category-identity";

import { CategoryDiscoveryProofControls } from "./category-discovery-proof-controls";
import { CategoryFilterBar } from "./category-filter-bar";
import { CategoryFollowControl } from "./category-follow-control";
import { CategoryRecordedRow } from "./category-recorded-row";
import { HomeProviderBanner } from "./home-provider-banner";
import { HomeStreamCard } from "./home-stream-card";

export function CategoryDetailView({
  onChangeIdentity,
  canLoadMore = false,
  categoryMatch = "found",
  onLoadMore,
  onRetryPage,
  onRetryCategoryMatch,
  onRetryProvider,
  onOpenAccounts,
  onWatch,
  onSelectProofMode,
  proofMode,
  pageErrors,
  recovering = false,
  view,
}: {
  readonly onChangeIdentity: (identity: CategoryRequestIdentity) => void;
  readonly canLoadMore?: boolean;
  readonly categoryMatch?: "loading" | "found" | "missing" | "failed";
  readonly onLoadMore?: () => void;
  readonly onRetryPage?: (platform: Platform) => void;
  readonly onRetryCategoryMatch?: () => void;
  readonly onRetryProvider?: (platform: Platform) => void;
  readonly onOpenAccounts: () => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly pageErrors?: Readonly<Record<Platform, string | undefined>>;
  readonly recovering?: boolean;
  readonly view: CategoryDetailModel;
}) {
  const media = view.media;
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<CategoryMediaItem>) => (
      <MediaRow item={item} {...(onWatch === undefined ? {} : { onWatch })} />
    ),
    [onWatch],
  );
  return (
    <FlatList<CategoryMediaItem>
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      data={media.kind === "unavailable" ? [] : media.items}
      key={JSON.stringify([
        view.identity.category.platform,
        view.identity.category.id,
        view.identity.platformScope,
        view.identity.tab,
        view.identity.language,
        view.identity.clipTimeRange,
        view.identity.videoSort,
        view.identity.tag,
      ])}
      keyExtractor={(item) => `${item.platform}:${item.id}`}
      renderItem={renderItem}
      onEndReached={canLoadMore ? onLoadMore : undefined}
      onEndReachedThreshold={0.4}
      style={styles.scroll}
      testID="category-detail-screen"
      ListHeaderComponent={
        <CategoryListHeader
          categoryMatch={categoryMatch}
          onChangeIdentity={onChangeIdentity}
          onOpenAccounts={onOpenAccounts}
          onRetryCategoryMatch={onRetryCategoryMatch}
          onRetryProvider={onRetryProvider}
          onSelectProofMode={onSelectProofMode}
          proofMode={proofMode}
          recovering={recovering}
          view={view}
        />
      }
      ListFooterComponent={
        <CategoryListFooter pageErrors={pageErrors} onRetryPage={onRetryPage} />
      }
    />
  );
}

function CategoryListHeader({
  categoryMatch,
  onChangeIdentity,
  onOpenAccounts,
  onRetryCategoryMatch,
  onRetryProvider,
  onSelectProofMode,
  proofMode,
  recovering,
  view,
}: {
  readonly categoryMatch: "loading" | "found" | "missing" | "failed";
  readonly onChangeIdentity: (identity: CategoryRequestIdentity) => void;
  readonly onOpenAccounts: () => void;
  readonly onRetryCategoryMatch?: (() => void) | undefined;
  readonly onRetryProvider?: ((platform: Platform) => void) | undefined;
  readonly onSelectProofMode?:
    ((mode: DiscoveryFixtureMode) => void) | undefined;
  readonly proofMode?: DiscoveryFixtureMode | undefined;
  readonly recovering: boolean;
  readonly view: CategoryDetailModel;
}) {
  return (
    <View style={styles.section}>
      <Header view={view} />
      <CategoryFollowControl follow={view.follow} />
      <CategoryMatchStatus
        status={categoryMatch}
        onRetry={onRetryCategoryMatch}
      />
      <TabRow identity={view.identity} onChangeIdentity={onChangeIdentity} />
      <CategoryFilterBar identity={view.identity} onChange={onChangeIdentity} />
      <CategoryMediaStatus view={view} />
      {proofMode && onSelectProofMode ? (
        <CategoryDiscoveryProofControls
          mode={proofMode}
          onSelect={onSelectProofMode}
        />
      ) : null}
      <CategoryProviderBanners
        view={view}
        onOpenAccounts={onOpenAccounts}
        onRetryProvider={onRetryProvider}
      />
      <CategoryMediaAvailability view={view} recovering={recovering} />
    </View>
  );
}

function CategoryMatchStatus({
  status,
  onRetry,
}: {
  readonly status: "loading" | "found" | "missing" | "failed";
  readonly onRetry?: (() => void) | undefined;
}) {
  if (status === "missing")
    return (
      <Text selectable style={styles.summary}>
        This category was not found on the other platform.
      </Text>
    );
  if (status !== "failed") return null;
  return (
    <View>
      <Text selectable style={styles.summary}>
        Could not check the matching category on the other platform.
      </Text>
      {onRetry ? (
        <MobileButton
          accessibilityLabel="Retry category match"
          onPress={onRetry}
          testID="category-match-retry"
          variant="secondary"
        >
          Retry
        </MobileButton>
      ) : null}
    </View>
  );
}

function CategoryMediaStatus({ view }: { readonly view: CategoryDetailModel }) {
  const phase = phaseCopy(view);
  return phase ? (
    <Text selectable style={styles.summary} testID="category-detail-phase">
      {phase}
    </Text>
  ) : null;
}

function CategoryMediaAvailability({
  view,
  recovering,
}: {
  readonly view: CategoryDetailModel;
  readonly recovering: boolean;
}) {
  return (
    <>
      {(view.phase === "loading" || recovering) &&
      view.media.kind !== "unavailable" ? (
        <ActivityIndicator
          accessibilityLabel="Loading category"
          color={mobileColors.textPrimary}
          testID="category-loading"
        />
      ) : null}
      {view.media.kind === "unavailable" ? (
        <UnavailableMedia reason={view.media.reason} />
      ) : null}
    </>
  );
}

function CategoryProviderBanners({
  view,
  onOpenAccounts,
  onRetryProvider,
}: {
  readonly view: CategoryDetailModel;
  readonly onOpenAccounts: () => void;
  readonly onRetryProvider?: ((platform: Platform) => void) | undefined;
}) {
  const scopedPlatforms = platformsForScope(
    view.identity.platformScope,
    view.identity.category,
  );
  const showTwitch =
    scopedPlatforms.includes("twitch") &&
    categoryIdForPlatform(view.identity.category, "twitch") !== null;
  const showKick =
    view.identity.tab === "live" &&
    scopedPlatforms.includes("kick") &&
    categoryIdForPlatform(view.identity.category, "kick") !== null;
  return (
    <>
      {showTwitch ? (
        <HomeProviderBanner
          onOpenAccounts={onOpenAccounts}
          {...(onRetryProvider ? { onRetry: onRetryProvider } : {})}
          outcome={view.providers.twitch}
        />
      ) : null}
      {showKick ? (
        <HomeProviderBanner
          onOpenAccounts={onOpenAccounts}
          {...(onRetryProvider ? { onRetry: onRetryProvider } : {})}
          outcome={view.providers.kick}
        />
      ) : null}
    </>
  );
}

function CategoryListFooter({
  pageErrors,
  onRetryPage,
}: {
  readonly pageErrors?:
    Readonly<Record<Platform, string | undefined>> | undefined;
  readonly onRetryPage?: ((platform: Platform) => void) | undefined;
}) {
  return (
    <View style={styles.section}>
      {pageErrors?.twitch ? (
        <PageRetry
          platform="twitch"
          {...(onRetryPage === undefined ? {} : { onRetryPage })}
        />
      ) : null}
      {pageErrors?.kick ? (
        <PageRetry
          platform="kick"
          {...(onRetryPage === undefined ? {} : { onRetryPage })}
        />
      ) : null}
    </View>
  );
}

function Header({ view }: { readonly view: CategoryDetailModel }) {
  return (
    <View style={styles.header}>
      <View style={styles.artWrap}>
        {view.header.boxArtUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: view.header.boxArtUrl }}
            style={styles.art}
          />
        ) : (
          <View style={styles.artFallback}>
            <Text selectable style={styles.fallback}>
              {view.header.name}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.headerCopy}>
        <Text accessibilityRole="header" selectable style={mobileType.display}>
          {view.header.name}
        </Text>
        <Text selectable style={styles.viewers}>
          {view.viewerSummary > 0
            ? `${view.viewerSummary} live viewers`
            : "Live viewer count updates on the Live tab"}
        </Text>
      </View>
    </View>
  );
}

function TabRow({
  identity,
  onChangeIdentity,
}: {
  readonly identity: CategoryRequestIdentity;
  readonly onChangeIdentity: (identity: CategoryRequestIdentity) => void;
}) {
  return (
    <MobileUnderlineTabs
      accessibilityLabel="Category media"
      selectedId={identity.tab}
      tabs={(
        [
          { id: "live", label: "Live Streams" },
          { id: "clips", label: "Clips" },
          { id: "videos", label: "Videos" },
        ] as const
      ).map((tab) => ({
        ...tab,
        accessibilityLabel: `${tab.label} tab`,
        testID: `category-tab-${tab.id}`,
      }))}
      onSelect={(tab) =>
        onChangeIdentity({
          ...defaultCategoryRequest(
            identity.category,
            identity.language,
            identity.clipTimeRange,
          ),
          platformScope: identity.platformScope,
          tab,
          tag: identity.tag,
          videoSort: tab === "videos" ? "recent" : identity.videoSort,
        })
      }
      testID="category-tabs"
    />
  );
}

function MediaRow({
  item,
  onWatch,
}: {
  readonly item: CategoryMediaItem;
  readonly onWatch?: (target: WatchTarget) => void;
}) {
  if ("isLive" in item) {
    return (
      <HomeStreamCard
        stream={item}
        {...(onWatch === undefined
          ? {}
          : { onOpen: () => onWatch(watchTargetFromStream(item)) })}
      />
    );
  }
  return (
    <CategoryRecordedRow
      item={item}
      {...(onWatch === undefined
        ? {}
        : {
            onPress: () =>
              onWatch(
                "clipUrl" in item
                  ? watchTargetFromClip(item)
                  : watchTargetFromVideo(item),
              ),
          })}
    />
  );
}

function UnavailableMedia({
  reason,
}: {
  readonly reason: "kick-clips-unsupported" | "kick-videos-unsupported";
}) {
  return (
    <Text selectable style={styles.unsupported} testID="category-unsupported">
      {reason === "kick-clips-unsupported"
        ? "Kick clips are not available on the official guest catalog."
        : "Kick videos are not available. Videos are Twitch VODs only."}
    </Text>
  );
}

function PageRetry({
  platform,
  onRetryPage,
}: {
  readonly platform: Platform;
  readonly onRetryPage?: (platform: Platform) => void;
}) {
  return (
    <View>
      <Text
        selectable
        style={styles.summary}
      >{`${platform === "twitch" ? "Twitch" : "Kick"} could not load more streams.`}</Text>
      {onRetryPage ? (
        <MobileButton
          accessibilityLabel={`Retry ${platform} streams`}
          onPress={() => onRetryPage(platform)}
          testID={`category-page-retry-${platform}`}
          variant={platform}
        >
          Retry
        </MobileButton>
      ) : null}
    </View>
  );
}

function phaseCopy(view: CategoryDetailModel): string {
  if (view.media.kind === "unavailable") {
    return view.media.reason === "kick-clips-unsupported"
      ? "Kick clips are unavailable."
      : "Kick videos are unavailable.";
  }
  switch (view.phase) {
    case "loading":
      return "Loading…";
    case "ready":
      return "";
    case "offline-cache":
      return "Showing saved results.";
    case "empty":
      return "No results match these filters.";
    case "failed":
      return "Couldn’t load this category.";
  }
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  section: { gap: mobileSpacing.medium },
  header: { flexDirection: "row", gap: mobileSpacing.medium },
  artWrap: {
    aspectRatio: 3 / 4,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    overflow: "hidden",
    width: 96,
  },
  art: { height: "100%", width: "100%" },
  artFallback: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: mobileSpacing.xSmall,
  },
  fallback: {
    color: mobileColors.textPrimary,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  headerCopy: { flex: 1, gap: mobileSpacing.small, justifyContent: "center" },
  viewers: { color: mobileColors.textSecondary, fontSize: 14, lineHeight: 20 },
  summary: {
    ...mobileType.body,
  },
  unsupported: {
    color: mobileColors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
});
