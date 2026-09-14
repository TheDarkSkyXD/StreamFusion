import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { Clip, Video, Channel } from "@streamfusion/core/content";
import type { SearchResultType } from "@streamfusion/core/discovery";

import { mobileColors, mobileSpacing } from "@mobile/design/tokens";
import type { UnifiedSearchView } from "../capabilities/platform-reads";

import { HomeStreamCard } from "./home-stream-card";
import {
  SearchCategoryCard,
  SearchChannelCard,
  SearchClipCard,
  SearchVideoCard,
} from "./search-cards";

export function SearchResultsView({
  onOpenChannel,
  onWatchClip,
  onWatchVideo,
  view,
}: {
  readonly onOpenChannel?: (channel: Channel) => void;
  readonly onWatchClip?: (clip: Clip) => void;
  readonly onWatchVideo?: (video: Video) => void;
  readonly view: UnifiedSearchView;
}) {
  const tab = view.intent?.resultType ?? "all";
  const collection = view.collection;
  if (tab === "channels") {
    return (
      <Section title="Channels">
        {collection.channels.map((channel) => (
          <SearchChannelCard
            channel={channel}
            key={`${channel.platform}:${channel.id}`}
            {...watchProp("onOpen", onOpenChannel ? () => onOpenChannel(channel) : undefined)}
          />
        ))}
      </Section>
    );
  }
  if (tab === "streams") {
    return (
      <Section title="Streams">
        {collection.streams.map((stream) => (
          <HomeStreamCard
            key={`${stream.platform}:${stream.id}`}
            stream={stream}
          />
        ))}
      </Section>
    );
  }
  if (tab === "videos") {
    return (
      <Section title="Videos">{videoCards(collection.videos, onWatchVideo)}</Section>
    );
  }
  if (tab === "clips") {
    return (
      <Section title="Clips">{clipCards(collection.clips, onWatchClip)}</Section>
    );
  }
  if (tab === "categories") {
    return (
      <Section title="Categories">
        {collection.categories.map((category) => (
          <SearchCategoryCard
            category={category}
            key={`${category.platform}:${category.id}`}
          />
        ))}
      </Section>
    );
  }
  return (
    <View style={styles.stack} testID="search-results-all">
      {view.bestMatch ? (
        <Section title="Best match">
          <SearchChannelCard
            channel={view.bestMatch}
            {...watchProp(
              "onOpen",
              onOpenChannel
                ? () => {
                    const match = view.bestMatch;
                    if (match) onOpenChannel(match);
                  }
                : undefined,
            )}
          />
        </Section>
      ) : null}
      {collection.streams.length > 0 ? (
        <Section title="Live streams">
          {collection.streams.map((stream) => (
            <HomeStreamCard
              key={`${stream.platform}:${stream.id}`}
              stream={stream}
            />
          ))}
        </Section>
      ) : null}
      {collection.videos.length > 0 ? (
        <Section title="Videos">
          {videoCards(collection.videos, onWatchVideo)}
        </Section>
      ) : null}
      {collection.clips.length > 0 ? (
        <Section title="Clips">
          {clipCards(collection.clips, onWatchClip)}
        </Section>
      ) : null}
      {collection.categories.length > 0 ? (
        <Section title="Categories">
          {collection.categories.map((category) => (
            <SearchCategoryCard
              category={category}
              key={`${category.platform}:${category.id}`}
            />
          ))}
        </Section>
      ) : null}
    </View>
  );
}

function videoCards(
  videos: readonly Video[],
  onWatchVideo?: (video: Video) => void,
) {
  return videos.map((video) => (
    <SearchVideoCard
      key={`${video.platform}:${video.id}`}
      video={video}
      {...watchProp("onWatch", onWatchVideo)}
    />
  ));
}

function clipCards(
  clips: readonly Clip[],
  onWatchClip?: (clip: Clip) => void,
) {
  return clips.map((clip) => (
    <SearchClipCard
      clip={clip}
      key={`${clip.platform}:${clip.id}`}
      {...watchProp("onWatch", onWatchClip)}
    />
  ));
}

function watchProp<K extends string, V>(
  key: K,
  value: V | undefined,
): { readonly [P in K]: V } | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]: V });
}

function Section({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <View style={styles.stack}>
      <Text selectable style={styles.label}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function resultsHeading(tab: SearchResultType): string {
  switch (tab) {
    case "all":
      return "Results";
    case "channels":
      return "Channels";
    case "streams":
      return "Streams";
    case "videos":
      return "Videos";
    case "clips":
      return "Clips";
    case "categories":
      return "Categories";
  }
}

const styles = StyleSheet.create({
  stack: {
    gap: mobileSpacing.medium,
  },
  label: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
});
