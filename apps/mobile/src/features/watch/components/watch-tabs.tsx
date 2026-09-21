import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Stream } from "@streamfusion/core/content";

import { MobileButton } from "@mobile/design/button";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { MobileCatalogTags } from "@mobile/design/tag";
import {
  mobileColors,
  mobilePressRing,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
import type {
  WatchChatAvailability,
  WatchInfo,
  WatchRelated,
  WatchTab,
} from "../capabilities/watch";

/**
 * Under-player surface while watching.
 *
 * Default: live chat (or comments for VOD/clip). Stream info appears when the
 * player is tapped. Channel Home / Videos / Clips live on the channel surface
 * opened from the profile row — not as Info/Related/Chat chips here.
 */
export function WatchTabs({
  chat,
  info,
  onAddToMultistream,
  onChatRetry,
  onOpenRelated,
  onSelect,
  recorded = false,
  related,
  tab,
}: {
  readonly chat: WatchChatAvailability;
  readonly info: WatchInfo | null;
  readonly onAddToMultistream?: () => void;
  readonly onChatRetry?: () => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly onSelect: (tab: WatchTab) => void;
  readonly recorded?: boolean;
  readonly related: WatchRelated | null;
  readonly tab: WatchTab;
}) {
  const chatTab: WatchTab = recorded ? "comments" : "chat";
  return (
    <View style={styles.region} testID="watch-under-player">
      {tab === "info" ? (
        <Pressable
          accessibilityLabel={recorded ? "Show comments" : "Show chat"}
          accessibilityRole="button"
          onPress={() => onSelect(chatTab)}
          style={({ pressed }) => [
            styles.switchRow,
            pressed ? styles.switchPressed : null,
          ]}
          testID={recorded ? "watch-show-comments" : "watch-show-chat"}
        >
          <Text style={styles.switchLabel}>
            {recorded ? "Show comments" : "Show chat"}
          </Text>
        </Pressable>
      ) : null}
      {tab === "chat" ? (
        <ChatPane chat={chat} {...(onChatRetry === undefined ? {} : { onRetry: onChatRetry })} />
      ) : null}
      {tab === "comments" ? (
        <CommentsPane
          chat={chat}
          {...(onChatRetry === undefined ? {} : { onRetry: onChatRetry })}
        />
      ) : null}
      {tab === "info" ? (
        <>
          <InfoPane
            info={info}
            {...(onAddToMultistream === undefined ? {} : { onAddToMultistream })}
          />
          <RelatedPane onOpenRelated={onOpenRelated} related={related} />
        </>
      ) : null}
    </View>
  );
}

function CommentsPane({
  chat,
  onRetry,
}: {
  readonly chat: WatchChatAvailability;
  readonly onRetry?: () => void;
}) {
  return (
    <ChatPane
      chat={chat}
      testID="watch-comments"
      title="Comments"
      {...(onRetry === undefined ? {} : { onRetry })}
    />
  );
}

function ChatPane({
  chat,
  onRetry,
  testID = "watch-chat",
  title = "Chat",
}: {
  readonly chat: WatchChatAvailability;
  readonly onRetry?: () => void;
  readonly testID?: string;
  readonly title?: string;
}) {
  if (chat.kind === "connecting") {
    return (
      <MobileStatusPanel testID={testID} tone="loading">
        <Text selectable style={mobileType.title}>
          {title}
        </Text>
        <Text selectable style={mobileType.body}>
          {chat.detail}
        </Text>
      </MobileStatusPanel>
    );
  }
  if (chat.kind === "failed") {
    return (
      <MobileStatusPanel testID={testID} tone="error">
        <Text selectable style={mobileType.title}>
          {title}
        </Text>
        <Text selectable style={mobileType.body}>
          {chat.detail}
        </Text>
        {onRetry ? (
          <MobileButton
            accessibilityLabel="Retry chat"
            onPress={onRetry}
            testID={`${testID}-retry`}
            variant="secondary"
          >
            Retry
          </MobileButton>
        ) : null}
      </MobileStatusPanel>
    );
  }
  if (chat.kind === "unavailable") {
    return (
      <MobileStatusPanel testID={testID} tone="info">
        <Text selectable style={mobileType.title}>
          {title}
        </Text>
        <Text selectable style={mobileType.body}>
          {chat.detail}
        </Text>
      </MobileStatusPanel>
    );
  }
  if (chat.kind === "empty") {
    return (
      <MobileStatusPanel testID={testID} tone="empty">
        <Text selectable style={mobileType.title}>
          {title}
        </Text>
        <Text selectable style={mobileType.body}>
          {chat.detail}
        </Text>
      </MobileStatusPanel>
    );
  }
  return (
    <View style={styles.pane} testID={testID}>
      <Text selectable style={mobileType.title}>
        {title}
      </Text>
      {chat.messages.map((message) => (
        <Text
          key={message.id}
          selectable
          style={mobileType.body}
          testID={`watch-chat-message-${message.id}`}
        >
          {`${message.displayName}: ${message.text}`}
        </Text>
      ))}
    </View>
  );
}

function InfoPane({
  info,
  onAddToMultistream,
}: {
  readonly info: WatchInfo | null;
  readonly onAddToMultistream?: () => void;
}) {
  if (!info) {
    return (
      <MobileStatusPanel testID="watch-info" tone="loading">
        <Text selectable style={mobileType.body}>
          Loading channel details.
        </Text>
      </MobileStatusPanel>
    );
  }
  if (info.kind === "unavailable") {
    return (
      <MobileStatusPanel testID="watch-info" tone="error">
        <Text selectable style={mobileType.body}>
          {info.failure.kind === "cancelled"
            ? "Channel details were cancelled."
            : info.failure.detail}
        </Text>
      </MobileStatusPanel>
    );
  }
  if (info.kind === "recorded") {
    return (
      <View style={styles.pane} testID="watch-info">
        <Text selectable style={mobileType.title}>
          {info.title}
        </Text>
        <Text selectable style={mobileType.body}>
          {`${info.channel.displayName} · ${info.mediaKind} · ${Math.max(0, Math.floor(info.durationSeconds))}s`}
        </Text>
        <Text selectable style={mobileType.body}>
          Multistream keeps live channels only.
        </Text>
      </View>
    );
  }
  if (info.kind === "ended") {
    return (
      <View style={styles.pane} testID="watch-info">
        <View style={styles.identity}>
          <Text selectable style={mobileType.title}>
            {info.channel.displayName}
          </Text>
          {info.channel.isVerified ? (
            <MobileVerifiedBadge platform={info.channel.platform} />
          ) : null}
        </View>
        <Text selectable style={mobileType.body}>
          This channel is not live.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.pane} testID="watch-info">
      <Text selectable style={mobileType.title}>
        {info.stream.title}
      </Text>
      <View style={styles.identity}>
        <Text selectable style={mobileType.body}>
          {`${info.channel.displayName} · ${info.stream.viewerCount} viewers`}
        </Text>
        {info.channel.isVerified ? (
          <MobileVerifiedBadge platform={info.channel.platform} />
        ) : null}
      </View>
      {info.stream.categoryName ? (
        <Text selectable style={styles.category}>
          {info.stream.categoryName}
        </Text>
      ) : null}
      <MobileCatalogTags
        language={info.stream.language}
        tags={info.stream.tags}
        testID="watch-info-tags"
      />
      {onAddToMultistream ? (
        <MobileButton
          accessibilityHint="Adds this live channel to the Multistream room"
          accessibilityLabel="Add to Multistream"
          onPress={onAddToMultistream}
          testID="watch-add-multistream"
          variant="secondary"
        >
          Add to Multistream
        </MobileButton>
      ) : null}
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
      <MobileStatusPanel testID="watch-related" tone="loading">
        <Text selectable style={mobileType.body}>
          Loading related streams.
        </Text>
      </MobileStatusPanel>
    );
  }
  if (related.kind === "empty") {
    return (
      <MobileStatusPanel testID="watch-related" tone="empty">
        <Text selectable style={mobileType.body}>
          No related live streams.
        </Text>
      </MobileStatusPanel>
    );
  }
  if (related.kind === "unavailable") {
    return (
      <MobileStatusPanel testID="watch-related" tone="error">
        <Text selectable style={mobileType.body}>
          {related.failure.kind === "cancelled"
            ? "Related streams were cancelled."
            : related.failure.detail}
        </Text>
      </MobileStatusPanel>
    );
  }
  return (
    <View style={styles.pane} testID="watch-related">
      <Text selectable style={mobileType.title}>
        Related
      </Text>
      {related.items.map((stream) => (
        <Pressable
          accessibilityRole="button"
          key={`${stream.platform}-${stream.channelId}`}
          onPress={() => onOpenRelated(stream)}
          style={({ pressed }) => [
            styles.relatedRow,
            pressed ? styles.relatedPressed : null,
          ]}
          testID={`watch-related-${stream.channelId}`}
        >
          <View style={styles.relatedHeading}>
            <View style={styles.identity}>
              <Text selectable style={mobileType.title}>
                {stream.channelDisplayName}
              </Text>
              {stream.channelIsVerified ? (
                <MobileVerifiedBadge platform={stream.platform} />
              ) : null}
            </View>
            <MobilePlatformBadge platform={stream.platform} />
          </View>
          <Text selectable style={mobileType.body}>
            {stream.title}
          </Text>
          <MobileCatalogTags language={stream.language} tags={stream.tags} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  region: {
    gap: mobileSpacing.small,
  },
  switchRow: {
    ...mobilePressRing.rest,
    alignSelf: "flex-start",
    borderRadius: mobileRadii.full,
    minHeight: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    paddingHorizontal: mobileSpacing.medium,
  },
  switchPressed: {
    ...mobilePressRing.pressed,
  },
  switchLabel: {
    ...mobileType.label,
    color: mobileColors.twitchBright,
  },
  pane: {
    gap: mobileSpacing.small,
  },
  identity: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  relatedHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    justifyContent: "space-between",
  },
  relatedRow: {
    ...mobilePressRing.rest,
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.large,
    gap: mobileSpacing.xSmall,
    minHeight: mobileSizing.minimumTouchTarget,
    padding: mobileSpacing.medium,
  },
  relatedPressed: {
    ...mobilePressRing.pressed,
  },
  category: {
    ...mobileType.label,
    color: mobileColors.textCategory,
  },
});
