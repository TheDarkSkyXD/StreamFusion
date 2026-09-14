import { StyleSheet, Text, View } from "react-native";
import type { Clip, Video } from "@streamfusion/core/content";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  ChannelDetailView as ChannelDetailModel,
  ChannelMediaRead,
} from "../capabilities/platform-reads";
import { mediaItems } from "../domain/channel-detail";
import { watchTargetFromClip, watchTargetFromVideo } from "../domain/channel-watch-target";
import { ChannelMediaRow } from "./channel-media-row";
import { HomeStreamCard } from "./home-stream-card";

const MEDIA_COPY = {
  empty: {
    clips: "No clips are available.",
    videos: "No videos are available.",
  },
  failed: {
    clips: "Clips could not be loaded.",
    videos: "Videos could not be loaded.",
  },
  loading: {
    clips: "Loading clips.",
    videos: "Loading videos.",
  },
  unsupported: {
    clips: "Kick does not publish clips on the official public API.",
    videos: "Kick videos are unavailable for this channel.",
  },
} as const;

export function HomeTab({
  onWatch,
  view,
}: {
  readonly onWatch?: (target: WatchTarget) => void;
  readonly view: ChannelDetailModel;
}) {
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
      <MediaTab kind="videos" lane={view.videos} {...watchProp(onWatch)} />
    </View>
  );
}

export function MediaTab({
  kind,
  lane,
  onWatch,
}: {
  readonly kind: "videos" | "clips";
  readonly lane: ChannelMediaRead<Clip | Video>;
  readonly onWatch?: (target: WatchTarget) => void;
}) {
  if (lane.kind === "unsupported") {
    return <MediaStatus kind={kind} state="unsupported" />;
  }
  if (lane.kind === "page" && lane.outcome.status === "failed") {
    return <MediaStatus kind={kind} state="failed" />;
  }
  const items = mediaItems(lane);
  if (items.length === 0) {
    const loading =
      lane.kind === "page" && lane.outcome.status === "partial";
    return <MediaStatus kind={kind} state={loading ? "loading" : "empty"} />;
  }
  return (
    <View style={styles.section} testID={`channel-${kind}-list`}>
      {items.map((item) => (
        <ChannelMediaRow
          item={item}
          key={`${item.platform}:${item.id}`}
          {...watchPress(item, kind, onWatch)}
        />
      ))}
    </View>
  );
}

function MediaStatus({
  kind,
  state,
}: {
  readonly kind: "videos" | "clips";
  readonly state: keyof typeof MEDIA_COPY;
}) {
  return (
    <Text selectable style={styles.meta} testID={`channel-${kind}-${state}`}>
      {MEDIA_COPY[state][kind]}
    </Text>
  );
}

function watchPress(
  item: Clip | Video,
  kind: "videos" | "clips",
  onWatch?: (target: WatchTarget) => void,
): { readonly onPress: () => void } | Record<string, never> {
  if (onWatch === undefined) return {};
  return {
    onPress: () =>
      onWatch(
        kind === "clips"
          ? watchTargetFromClip(item as Clip)
          : watchTargetFromVideo(item as Video),
      ),
  };
}

function watchProp(
  onWatch?: (target: WatchTarget) => void,
): { readonly onWatch: (target: WatchTarget) => void } | Record<string, never> {
  return onWatch === undefined ? {} : { onWatch };
}

const styles = StyleSheet.create({
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
});
