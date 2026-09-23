import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { FollowingSession } from "@mobile/features/follows/capabilities/following-session";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import type {
  ChannelDetailTab,
  ChannelDetailView as ChannelDetailModel,
  DiscoverySession,
} from "../capabilities/platform-reads";
import {
  type ChannelFixtureMode,
} from "../domain/channel-fixture";
import { ChannelHeader } from "./channel-header";
import { HomeTab, MediaTab } from "./channel-detail-media";
import { ChannelProofControls } from "./channel-proof-controls";
import { ChannelTabs } from "./channel-tabs";
import { useChannelDetail } from "./use-channel-detail";
import { useChannelFollow } from "./use-channel-follow";

export function ChannelDetailScreen({
  channel,
  following,
  onWatch,
  session,
}: {
  readonly channel: ChannelIdentity;
  readonly following: FollowingSession;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly session: DiscoverySession;
}) {
  const [tab, setTab] = useState<ChannelDetailTab>("home");
  const live = useChannelDetail({
    channel,
    loadClips: tab === "clips",
    session,
  });
  const follow = useChannelFollow({
    channel,
    following,
    ...(live.view.channel?.displayName
      ? { displayName: live.view.channel.displayName }
      : {}),
  });
  return (
    <ChannelDetailView
      channel={channel}
      onFollow={follow.toggle}
      onOpenProviderPage={follow.openProviderPage}
      onRetry={live.retry}
      onSelectTab={setTab}
      tab={tab}
      view={{ ...live.view, follow: follow.follow }}
      {...watchProp(onWatch)}
    />
  );
}

export function ChannelDetailView({
  channel,
  onFollow,
  onOpenProviderPage,
  onRetry,
  onSelectProofMode,
  onSelectTab,
  onWatch,
  proofMode,
  tab,
  view,
}: {
  readonly channel: ChannelIdentity;
  readonly onFollow: () => void;
  readonly onOpenProviderPage: () => void;
  readonly onRetry: () => void;
  readonly onSelectProofMode?: (mode: ChannelFixtureMode) => void;
  readonly onSelectTab: (tab: ChannelDetailTab) => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly proofMode?: ChannelFixtureMode;
  readonly tab: ChannelDetailTab;
  readonly view: ChannelDetailModel;
}) {
  return (
    <ChannelDetailBody
      channel={channel}
      onFollow={onFollow}
      onOpenProviderPage={onOpenProviderPage}
      onRetry={onRetry}
      onSelectTab={onSelectTab}
      tab={tab}
      view={view}
      {...watchProp(onWatch)}
      {...(onSelectProofMode === undefined
        ? {}
        : { onSelectProofMode, proofMode })}
    />
  );
}

export function ChannelDetailBody({
  channel,
  onFollow,
  onOpenProviderPage,
  onRetry,
  onSelectProofMode,
  onSelectTab,
  onWatch,
  proofMode,
  tab,
  view,
}: {
  readonly channel: ChannelIdentity;
  readonly onFollow: () => void;
  readonly onOpenProviderPage: () => void;
  readonly onRetry: () => void;
  readonly onSelectProofMode?: (mode: ChannelFixtureMode) => void;
  readonly onSelectTab: (tab: ChannelDetailTab) => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly proofMode?: ChannelFixtureMode;
  readonly tab: ChannelDetailTab;
  readonly view: ChannelDetailModel;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      style={styles.scroll}
      testID="channel-detail"
    >
      <Text selectable style={styles.eyebrow}>
        CHANNEL
      </Text>
      <Text selectable style={styles.summary} testID="channel-phase">
        {phaseCopy(view, channel)}
      </Text>
      {proofMode && onSelectProofMode ? (
        <ChannelProofControls mode={proofMode} onSelect={onSelectProofMode} />
      ) : null}
      {view.page.cache.kind === "hit" ? (
        <Text selectable style={styles.meta} testID="channel-cache-age">
          {`Cached ${Math.max(1, Math.round(view.page.cache.ageMilliseconds / 60_000))} min ago`}
        </Text>
      ) : null}
      {view.channel ? (
        <ChannelHeader
          channel={view.channel}
          follow={view.follow}
          onFollow={onFollow}
          onOpenProviderPage={onOpenProviderPage}
          onWatch={() => {
            if (view.watch.kind !== "available") return;
            onWatch?.(view.watch.target);
          }}
          watch={view.watch}
        />
      ) : null}
      {view.phase === "failed" || view.phase === "empty" ? (
        <Pressable
          accessibilityLabel="Retry channel"
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.retry,
            pressed ? styles.pressed : null,
          ]}
          testID="channel-retry"
        >
          <Text selectable style={styles.retryLabel}>
            Retry
          </Text>
        </Pressable>
      ) : null}
      <ChannelTabs onSelect={onSelectTab} tab={tab} />
      {tab === "home" ? <HomeTab {...watchProp(onWatch)} view={view} /> : null}
      {tab === "videos" ? (
        <MediaTab kind="videos" lane={view.videos} {...watchProp(onWatch)} />
      ) : null}
      {tab === "clips" ? (
        <MediaTab kind="clips" lane={view.clips} {...watchProp(onWatch)} />
      ) : null}
    </ScrollView>
  );
}

function phaseCopy(view: ChannelDetailModel, channel: ChannelIdentity): string {
  if (view.phase === "loading") return "Loading channel details.";
  if (view.phase === "failed") return "Channel details could not be loaded.";
  if (view.phase === "empty") return "This channel could not be found.";
  if (view.phase === "offline-cache") {
    return "Showing a cached channel while a live read is unavailable.";
  }
  return `${channel.username} on ${channel.platform}.`;
}

function watchProp(
  onWatch?: (target: WatchTarget) => void,
): { readonly onWatch: (target: WatchTarget) => void } | Record<string, never> {
  return onWatch === undefined ? {} : { onWatch };
}


const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  eyebrow: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
  summary: {
    color: mobileColors.textCategory,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
  retry: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
  },
  retryLabel: {
    color: mobileColors.background,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  pressed: { opacity: 0.76 },
});
