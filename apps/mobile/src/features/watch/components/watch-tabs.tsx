import { useTranslation } from "react-i18next";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
import { formatWatchViewerCount } from "../domain/watch-live-meta";

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
  onChatRetry,
  onOpenRelated,
  onSelect,
  recorded = false,
  related,
  tab,
}: {
  readonly chat: WatchChatAvailability;
  readonly info: WatchInfo | null;
  readonly onChatRetry?: () => void;
  readonly onOpenRelated: (stream: Stream) => void;
  readonly onSelect: (tab: WatchTab) => void;
  readonly recorded?: boolean;
  readonly related: WatchRelated | null;
  readonly tab: WatchTab;
}) {
  const { t } = useTranslation();
  const chatTab: WatchTab = recorded ? "comments" : "chat";
  return (
    <View style={styles.region} testID="watch-under-player">
      {tab === "info" ? (
        <Pressable
          accessibilityLabel={
            recorded ? t("playback.watch.showComments") : t("playback.watch.showChat")
          }
          accessibilityRole="button"
          onPress={() => onSelect(chatTab)}
          style={({ pressed }) => [
            styles.switchRow,
            pressed ? styles.switchPressed : null,
          ]}
          testID={recorded ? "watch-show-comments" : "watch-show-chat"}
        >
          <Text style={styles.switchLabel}>
            {recorded ? t("playback.watch.showComments") : t("playback.watch.showChat")}
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
        <ScrollView
          contentContainerStyle={styles.infoScrollContent}
          style={styles.infoScroll}
          testID="watch-info-scroll"
        >
          <InfoPane info={info} />
          <RelatedPane onOpenRelated={onOpenRelated} related={related} />
        </ScrollView>
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
  const { t } = useTranslation();
  return (
    <ChatPane
      chat={chat}
      testID="watch-comments"
      title={t("playback.watch.comments")}
      {...(onRetry === undefined ? {} : { onRetry })}
    />
  );
}

function ChatPane({
  chat,
  onRetry,
  testID = "watch-chat",
  title,
}: {
  readonly chat: WatchChatAvailability;
  readonly onRetry?: () => void;
  readonly testID?: string;
  readonly title?: string;
}) {
  const { t } = useTranslation();
  const paneTitle = title ?? t("playback.watch.chat");
  if (chat.kind === "connecting") {
    return (
      <View style={styles.paneFill}>
        <MobileStatusPanel testID={testID} tone="loading">
          <Text selectable style={mobileType.title}>
            {paneTitle}
          </Text>
          <Text selectable style={mobileType.body}>
            {chat.detail}
          </Text>
        </MobileStatusPanel>
      </View>
    );
  }
  if (chat.kind === "failed") {
    return (
      <View style={styles.paneFill}>
        <MobileStatusPanel testID={testID} tone="error">
          <Text selectable style={mobileType.title}>
            {paneTitle}
          </Text>
          <Text selectable style={mobileType.body}>
            {chat.detail}
          </Text>
          {onRetry ? (
            <MobileButton
              accessibilityLabel={t("playback.watch.retryChat")}
              onPress={onRetry}
              testID={`${testID}-retry`}
              variant="secondary"
            >
              {t("playback.retry")}
            </MobileButton>
          ) : null}
        </MobileStatusPanel>
      </View>
    );
  }
  if (chat.kind === "unavailable") {
    return (
      <View style={styles.paneFill}>
        <MobileStatusPanel testID={testID} tone="info">
          <Text selectable style={mobileType.title}>
            {paneTitle}
          </Text>
          <Text selectable style={mobileType.body}>
            {chat.detail}
          </Text>
        </MobileStatusPanel>
      </View>
    );
  }
  if (chat.kind === "empty") {
    return (
      <View style={styles.paneFill}>
        <MobileStatusPanel testID={testID} tone="empty">
          <Text selectable style={mobileType.title}>
            {paneTitle}
          </Text>
          <Text selectable style={mobileType.body}>
            {chat.detail}
          </Text>
        </MobileStatusPanel>
      </View>
    );
  }
  return (
    <View style={styles.paneFill} testID={testID}>
      <Text selectable style={mobileType.title}>
        {paneTitle}
      </Text>
      <ScrollView
        contentContainerStyle={styles.messageList}
        style={styles.messageScroll}
        testID={`${testID}-scroll`}
      >
        {chat.messages.map((message) => (
          <View
            key={message.id}
            style={styles.messageRow}
            testID={`watch-chat-message-${message.id}`}
          >
            <View style={styles.messageChrome} testID={`watch-chat-chrome-${message.id}`}>
              {message.badges.map((badge) =>
                badge.imageUrl ? (
                  <Image
                    key={`${badge.setId}-${badge.version}`}
                    accessibilityIgnoresInvertColors
                    accessibilityLabel={badge.title}
                    resizeMode="contain"
                    source={{ uri: badge.imageUrl }}
                    style={styles.chatBadge}
                    testID={`watch-chat-badge-${message.id}-${badge.setId}`}
                  />
                ) : null,
              )}
              <View style={styles.messageNameSlot}>
                <Text selectable style={styles.messageName}>
                  {message.displayName}
                </Text>
              </View>
            </View>
            <Text selectable style={styles.messageText}>
              {`: ${message.text}`}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function InfoPane({
  info,
}: {
  readonly info: WatchInfo | null;
}) {
  const { i18n, t } = useTranslation();
  if (!info) {
    return (
      <MobileStatusPanel testID="watch-info" tone="loading">
        <Text selectable style={mobileType.body}>
          {t("playback.watch.loadingChannelDetails")}
        </Text>
      </MobileStatusPanel>
    );
  }
  if (info.kind === "unavailable") {
    return (
      <MobileStatusPanel testID="watch-info" tone="error">
        <Text selectable style={mobileType.body}>
          {info.failure.kind === "cancelled"
            ? t("playback.watch.channelDetailsCancelled")
            : info.failure.detail}
        </Text>
      </MobileStatusPanel>
    );
  }
  if (info.kind === "recorded") {
    return (
      <View style={styles.infoCard} testID="watch-info">
        <ChannelAvatar url={info.channel.avatarUrl} />
        <View style={styles.infoCopy}>
          <View style={styles.identity}>
            <Text selectable style={styles.infoName} testID="watch-info-display-name">
              {info.channel.displayName}
            </Text>
            {info.channel.isVerified ? (
              <MobileVerifiedBadge platform={info.channel.platform} />
            ) : null}
          </View>
          <Text selectable style={styles.infoTitle} testID="watch-info-title">
            {info.title}
          </Text>
          <Text selectable style={mobileType.body}>
            {`${info.mediaKind} · ${Math.max(0, Math.floor(info.durationSeconds))}s`}
          </Text>
        </View>
      </View>
    );
  }
  if (info.kind === "ended") {
    return (
      <View style={styles.infoCard} testID="watch-info">
        <ChannelAvatar url={info.channel.avatarUrl} />
        <View style={styles.infoCopy}>
          <View style={styles.identity}>
            <Text selectable style={styles.infoName} testID="watch-info-display-name">
              {info.channel.displayName}
            </Text>
            {info.channel.isVerified ? (
              <MobileVerifiedBadge platform={info.channel.platform} />
            ) : null}
          </View>
          <Text selectable style={mobileType.body}>
            {t("playback.watch.channelNotLive")}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.infoCard} testID="watch-info">
      <ChannelAvatar url={info.channel.avatarUrl} />
      <View style={styles.infoCopy}>
        <View style={styles.identity}>
          <Text selectable style={styles.infoName} testID="watch-info-display-name">
            {info.channel.displayName}
          </Text>
          {info.channel.isVerified ? (
            <MobileVerifiedBadge platform={info.channel.platform} />
          ) : null}
        </View>
        <Text selectable style={styles.infoTitle} testID="watch-info-title">
          {info.stream.title}
        </Text>
        {info.stream.categoryName ? (
          <Text selectable style={styles.category} testID="watch-info-category">
            {info.stream.categoryName}
          </Text>
        ) : null}
        <Text selectable style={styles.infoMeta} testID="watch-info-viewers">
          {`${formatWatchViewerCount(info.stream.viewerCount, i18n.resolvedLanguage ?? i18n.language ?? "en")} ${t("playback.viewers")}`}
        </Text>
        <MobileCatalogTags
          language={info.stream.language}
          tags={info.stream.tags}
          testID="watch-info-tags"
        />
      </View>
    </View>
  );
}

function ChannelAvatar({ url }: { readonly url: string }) {
  if (url === "") {
    return <View style={styles.infoAvatar} testID="watch-info-avatar-placeholder" />;
  }
  return (
    <Image
      accessibilityIgnoresInvertColors
      source={{ uri: url }}
      style={styles.infoAvatar}
      testID="watch-info-avatar"
    />
  );
}

function RelatedPane({
  onOpenRelated,
  related,
}: {
  readonly onOpenRelated: (stream: Stream) => void;
  readonly related: WatchRelated | null;
}) {
  const { t } = useTranslation();
  if (!related) {
    return (
      <MobileStatusPanel testID="watch-related" tone="loading">
        <Text selectable style={mobileType.body}>
          {t("playback.watch.loadingRelated")}
        </Text>
      </MobileStatusPanel>
    );
  }
  if (related.kind === "empty") {
    return (
      <MobileStatusPanel testID="watch-related" tone="empty">
        <Text selectable style={mobileType.body}>
          {t("playback.watch.noRelated")}
        </Text>
      </MobileStatusPanel>
    );
  }
  if (related.kind === "unavailable") {
    return (
      <MobileStatusPanel testID="watch-related" tone="error">
        <Text selectable style={mobileType.body}>
          {related.failure.kind === "cancelled"
            ? t("playback.watch.relatedCancelled")
            : related.failure.detail}
        </Text>
      </MobileStatusPanel>
    );
  }
  return (
    <View style={styles.pane} testID="watch-related">
      <Text selectable style={mobileType.title}>
        {t("playback.watch.related")}
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
    flex: 1,
    gap: mobileSpacing.small,
    minHeight: 0,
    paddingHorizontal: mobileSpacing.medium,
    paddingTop: mobileSpacing.small,
  },
  paneFill: {
    flex: 1,
    gap: mobileSpacing.small,
    minHeight: 0,
  },
  messageScroll: {
    flex: 1,
    minHeight: 0,
  },
  messageList: {
    gap: mobileSpacing.small,
    paddingBottom: mobileSpacing.medium,
  },
  messageRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  messageChrome: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 0,
    gap: 4,
    height: 18,
  },
  chatBadge: {
    height: 18,
    width: 18,
  },
  messageNameSlot: {
    height: 18,
    justifyContent: "center",
  },
  messageText: {
    color: mobileColors.textSecondary,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "500",
    includeFontPadding: false,
    lineHeight: 18,
  },
  messageName: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    includeFontPadding: false,
    lineHeight: 18,
    textAlignVertical: "center",
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
  infoScroll: {
    flex: 1,
    minHeight: 0,
  },
  infoScrollContent: {
    gap: mobileSpacing.small,
    paddingBottom: mobileSpacing.medium,
  },
  infoCard: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: mobileSpacing.medium,
  },
  infoAvatar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: 64,
    width: 64,
  },
  infoCopy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
    minWidth: 0,
  },
  infoName: {
    ...mobileType.title,
    fontSize: 18,
    lineHeight: 24,
  },
  infoTitle: {
    ...mobileType.body,
    color: mobileColors.textPrimary,
    fontWeight: "600",
  },
  infoMeta: {
    ...mobileType.caption,
    color: mobileColors.textSecondary,
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
