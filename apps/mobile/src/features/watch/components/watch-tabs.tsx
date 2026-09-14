import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Stream } from "@streamfusion/core/content";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  WatchChatAvailability,
  WatchInfo,
  WatchRelated,
  WatchTab,
} from "../capabilities/watch";

export function WatchTabs({
  chat,
  info,
  onOpenRelated,
  onSelect,
  related,
  tab,
}: {
  readonly chat: WatchChatAvailability;
  readonly info: WatchInfo | null;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly onSelect: (tab: WatchTab) => void;
  readonly related: WatchRelated | null;
  readonly tab: WatchTab;
}) {
  return (
    <View style={styles.region}>
      <View accessibilityRole="tablist" style={styles.tabs}>
        <TabButton active={tab === "info"} label="Info" onPress={() => onSelect("info")} />
        <TabButton active={tab === "related"} label="Related" onPress={() => onSelect("related")} />
        <TabButton active={tab === "chat"} label="Chat" onPress={() => onSelect("chat")} />
      </View>
      {tab === "chat" ? <ChatPane chat={chat} /> : null}
      {tab === "info" ? <InfoPane info={info} /> : null}
      {tab === "related" ? (
        <RelatedPane onOpenRelated={onOpenRelated} related={related} />
      ) : null}
    </View>
  );
}

function TabButton({
  active,
  label,
  onPress,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.tab, active ? styles.tabActive : null]}
      testID={`watch-tab-${label.toLowerCase()}`}
    >
      <Text selectable style={styles.tabLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function ChatPane({ chat }: { readonly chat: WatchChatAvailability }) {
  return (
    <View style={styles.pane} testID="watch-chat">
      <Text selectable style={styles.body}>
        {chat.detail}
      </Text>
    </View>
  );
}

function InfoPane({ info }: { readonly info: WatchInfo | null }) {
  if (!info) {
    return (
      <View style={styles.pane} testID="watch-info">
        <Text selectable style={styles.body}>
          Loading channel details.
        </Text>
      </View>
    );
  }
  if (info.kind === "unavailable") {
    return (
      <View style={styles.pane} testID="watch-info">
        <Text selectable style={styles.body}>
          {info.failure.kind === "cancelled"
            ? "Channel details were cancelled."
            : info.failure.detail}
        </Text>
      </View>
    );
  }
  if (info.kind === "ended") {
    return (
      <View style={styles.pane} testID="watch-info">
        <Text selectable style={styles.title}>
          {info.channel.displayName}
        </Text>
        <Text selectable style={styles.body}>
          This channel is not live.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.pane} testID="watch-info">
      <Text selectable style={styles.title}>
        {info.stream.title}
      </Text>
      <Text selectable style={styles.body}>
        {`${info.channel.displayName} · ${info.stream.viewerCount} viewers`}
      </Text>
    </View>
  );
}

function RelatedPane({
  onOpenRelated,
  related,
}: {
  readonly onOpenRelated: (stream: Stream) => void;
  readonly related: WatchRelated | null;
}) {
  if (!related) {
    return (
      <View style={styles.pane} testID="watch-related">
        <Text selectable style={styles.body}>
          Loading related streams.
        </Text>
      </View>
    );
  }
  if (related.kind === "empty") {
    return (
      <View style={styles.pane} testID="watch-related">
        <Text selectable style={styles.body}>
          No related live streams.
        </Text>
      </View>
    );
  }
  if (related.kind === "unavailable") {
    return (
      <View style={styles.pane} testID="watch-related">
        <Text selectable style={styles.body}>
          {related.failure.kind === "cancelled"
            ? "Related streams were cancelled."
            : related.failure.detail}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.pane} testID="watch-related">
      {related.items.map((stream) => (
        <Pressable
          accessibilityRole="button"
          key={`${stream.platform}-${stream.channelId}`}
          onPress={() => onOpenRelated(stream)}
          style={styles.relatedRow}
          testID={`watch-related-${stream.channelId}`}
        >
          <Text selectable style={styles.title}>
            {stream.channelDisplayName}
          </Text>
          <Text selectable style={styles.body}>
            {stream.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  region: {
    gap: mobileSpacing.small,
  },
  tabs: {
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
  },
  tab: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  tabActive: {
    backgroundColor: mobileColors.textPrimary,
  },
  tabLabel: {
    color: mobileColors.background,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  pane: {
    gap: mobileSpacing.xSmall,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  body: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  relatedRow: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    minHeight: mobileSizing.minimumTouchTarget,
    padding: mobileSpacing.medium,
  },
});
