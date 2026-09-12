import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  ChannelDetailTab,
  ChannelDetailView as ChannelDetailModel,
  ChannelMediaRead,
  DiscoverySession,
} from "../capabilities/platform-reads";
import { mediaItems } from "../domain/channel-detail";
import {
  fixtureChannelDetail,
  type ChannelFixtureMode,
} from "../domain/channel-fixture";
import { ChannelHeader } from "./channel-header";
import { ChannelMediaRow } from "./channel-media-row";
import { ChannelProofControls } from "./channel-proof-controls";
import { ChannelTabs } from "./channel-tabs";
import { HomeStreamCard } from "./home-stream-card";
import { useChannelDetail } from "./use-channel-detail";

export function ChannelDetailScreen({
  channel,
  session,
}: {
  readonly channel: ChannelIdentity;
  readonly session: DiscoverySession;
}) {
  const [mode, setMode] = useState<ChannelFixtureMode>("live");
  const live = useChannelDetail({
    channel,
    enabled: mode === "live",
    session,
  });
  const view =
    mode === "live" ? live.view : fixtureChannelDetail(channel, mode);
  return (
    <ChannelDetailView
      channel={channel}
      onRetry={live.retry}
      view={view}
      {...(__DEV__ ? { onSelectProofMode: setMode, proofMode: mode } : {})}
    />
  );
}

export function ChannelDetailView({
  channel,
  onRetry,
  onSelectProofMode,
  proofMode,
  view,
}: {
  readonly channel: ChannelIdentity;
  readonly onRetry: () => void;
  readonly onSelectProofMode?: (mode: ChannelFixtureMode) => void;
  readonly proofMode?: ChannelFixtureMode;
  readonly view: ChannelDetailModel;
}) {
  const [tab, setTab] = useState<ChannelDetailTab>("home");
  return (
    <ChannelDetailBody
      channel={channel}
      onRetry={onRetry}
      onSelectTab={setTab}
      tab={tab}
      view={view}
      {...(onSelectProofMode === undefined
        ? {}
        : { onSelectProofMode, proofMode })}
    />
  );
}

export function ChannelDetailBody({
  channel,
  onRetry,
  onSelectProofMode,
  onSelectTab,
  proofMode,
  tab,
  view,
}: {
  readonly channel: ChannelIdentity;
  readonly onRetry: () => void;
  readonly onSelectProofMode?: (mode: ChannelFixtureMode) => void;
  readonly onSelectTab: (tab: ChannelDetailTab) => void;
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
          onWatch={() => undefined}
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
      {tab === "home" ? <HomeTab view={view} /> : null}
      {tab === "videos" ? <MediaTab kind="videos" lane={view.videos} /> : null}
      {tab === "clips" ? <MediaTab kind="clips" lane={view.clips} /> : null}
    </ScrollView>
  );
}

function HomeTab({ view }: { readonly view: ChannelDetailModel }) {
  return (
    <View style={styles.section} testID="channel-home-tab">
      {view.live ? (
        <HomeStreamCard stream={view.live} />
      ) : (
        <Text selectable style={styles.meta} testID="channel-offline">
          This channel is offline.
        </Text>
      )}
      {view.channel?.bio ? (
        <View style={styles.about} testID="channel-about">
          <Text selectable style={styles.aboutTitle}>
            About
          </Text>
          <Text selectable style={styles.meta}>
            {view.channel.bio}
          </Text>
          {view.channel.categoryName ? (
            <Text selectable style={styles.meta}>
              {view.channel.categoryName}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text selectable style={styles.sectionTitle}>
        Recent broadcasts
      </Text>
      <MediaTab kind="videos" lane={view.videos} />
    </View>
  );
}

function MediaTab({
  kind,
  lane,
}: {
  readonly kind: "videos" | "clips";
  readonly lane: ChannelMediaRead<
    | import("@streamfusion/core/content").Clip
    | import("@streamfusion/core/content").Video
  >;
}) {
  if (lane.kind === "unsupported") {
    return (
      <Text
        selectable
        style={styles.meta}
        testID={`channel-${kind}-unsupported`}
      >
        {kind === "videos"
          ? "Kick does not publish videos on the official public API."
          : "Kick does not publish clips on the official public API."}
      </Text>
    );
  }
  const items = mediaItems(lane);
  if (items.length === 0) {
    return (
      <Text selectable style={styles.meta} testID={`channel-${kind}-empty`}>
        {kind === "videos"
          ? "No videos are available."
          : "No clips are available."}
      </Text>
    );
  }
  return (
    <View style={styles.section} testID={`channel-${kind}-list`}>
      {items.map((item) => (
        <ChannelMediaRow item={item} key={`${item.platform}:${item.id}`} />
      ))}
    </View>
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
  section: { gap: mobileSpacing.small },
  sectionTitle: {
    color: mobileColors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  about: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  aboutTitle: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
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
