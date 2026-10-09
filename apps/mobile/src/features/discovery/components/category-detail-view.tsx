import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

import { MobileUnderlineTabs } from "@mobile/design/underline-tabs";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { DiscoveryFixtureMode } from "../capabilities/platform-reads";
import type { CategoryDetailView as CategoryDetailModel } from "../domain/category-detail";
import {
  watchTargetFromClip,
  watchTargetFromStream,
  watchTargetFromVideo,
} from "../domain/channel-watch-target";
import {
  defaultCategoryRequest,
  platformsForScope,
  type CategoryRequestIdentity,
} from "../domain/category-identity";

import { CategoryDiscoveryProofControls } from "./category-discovery-proof-controls";
import { CategoryFilterBar } from "./category-filter-bar";
import { CategoryFollowControl } from "./category-follow-control";
import { CategoryRecordedRow } from "./category-recorded-row";
import { DiscoverySearchDock } from "./discovery-search-dock";
import { HomeProviderBanner } from "./home-provider-banner";
import { HomeStreamCard } from "./home-stream-card";

export function CategoryDetailView({
  onChangeIdentity,
  onChangeQuery,
  onOpenAccounts,
  onWatch,
  onSelectProofMode,
  proofMode,
  query,
  recovering = false,
  view,
}: {
  readonly onChangeIdentity: (identity: CategoryRequestIdentity) => void;
  readonly onChangeQuery: (query: string) => void;
  readonly onOpenAccounts: () => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly onSelectProofMode?: (mode: DiscoveryFixtureMode) => void;
  readonly proofMode?: DiscoveryFixtureMode;
  readonly query: string;
  readonly recovering?: boolean;
  readonly view: CategoryDetailModel;
}) {
  const media = filterMedia(view, query);
  const phase = phaseCopy(view);
  const scopedPlatforms = platformsForScope(
    view.identity.platformScope,
    view.identity.category,
  );
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="category-detail-screen"
    >
      <Header view={view} />
      <CategoryFollowControl follow={view.follow} />
      <TabRow identity={view.identity} onChangeIdentity={onChangeIdentity} />
      <CategoryFilterBar
        availableTags={availableTags(view)}
        identity={view.identity}
        onChange={onChangeIdentity}
      />
      {phase ? (
        <Text selectable style={styles.summary} testID="category-detail-phase">
          {phase}
        </Text>
      ) : null}
      {proofMode && onSelectProofMode ? (
        <CategoryDiscoveryProofControls
          mode={proofMode}
          onSelect={onSelectProofMode}
        />
      ) : null}
      {scopedPlatforms.includes("twitch") ? (
        <HomeProviderBanner
          onOpenAccounts={onOpenAccounts}
          outcome={view.providers.twitch}
        />
      ) : null}
      {view.identity.tab === "live" && scopedPlatforms.includes("kick") ? (
        <HomeProviderBanner
          onOpenAccounts={onOpenAccounts}
          outcome={view.providers.kick}
        />
      ) : null}
      {(view.phase === "loading" || recovering) &&
      media.kind !== "unavailable" ? (
        <ActivityIndicator
          accessibilityLabel="Loading category"
          color={mobileColors.textPrimary}
          testID="category-loading"
        />
      ) : null}
      <MediaList
        media={media}
        {...(onWatch === undefined ? {} : { onWatch })}
      />
      <DiscoverySearchDock
        onChangeQuery={onChangeQuery}
        placeholder={`Search in ${view.header.name}`}
        query={query}
        testID="category-detail-search"
      />
    </ScrollView>
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

function MediaList({
  media,
  onWatch,
}: {
  readonly media: CategoryDetailModel["media"];
  readonly onWatch?: (target: WatchTarget) => void;
}) {
  if (media.kind === "unavailable") {
    return (
      <Text selectable style={styles.unsupported} testID="category-unsupported">
        {media.reason === "kick-clips-unsupported"
          ? "Kick clips are not available on the official guest catalog."
          : "Kick videos are not available. Videos are Twitch VODs only."}
      </Text>
    );
  }
  if (media.kind === "live") {
    return (
      <>
        {media.items.map((stream) => (
          <HomeStreamCard
            key={`${stream.platform}:${stream.id}`}
            stream={stream}
            {...(onWatch === undefined
              ? {}
              : { onOpen: () => onWatch(watchTargetFromStream(stream)) })}
          />
        ))}
      </>
    );
  }
  return (
    <>
      {media.items.map((item) => (
        <CategoryRecordedRow
          item={item}
          key={`${item.platform}:${item.id}`}
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
      ))}
    </>
  );
}

function filterMedia(
  view: CategoryDetailModel,
  query: string,
): CategoryDetailModel["media"] {
  const needle = query.trim().toLowerCase();
  if (needle === "" || view.media.kind === "unavailable") return view.media;
  return {
    ...view.media,
    items: view.media.items.filter((item) =>
      item.title.toLowerCase().includes(needle),
    ),
  } as CategoryDetailModel["media"];
}

function availableTags(view: CategoryDetailModel): readonly string[] {
  if (view.identity.tab !== "live") return [];
  const tags = [view.providers.twitch, view.providers.kick]
    .flatMap((provider) => provider.items)
    .flatMap((item) => ("isLive" in item && "tags" in item ? item.tags : []));
  return [...new Set(tags)].sort((left, right) => left.localeCompare(right));
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
