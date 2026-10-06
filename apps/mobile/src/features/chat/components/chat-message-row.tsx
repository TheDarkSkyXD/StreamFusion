import { memo, useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Platform } from "@streamfusion/core/platform";
import { mobileColors, mobileRadii, mobileType } from "@mobile/design/tokens";
import { MobileEmoteImage } from "@mobile/design/emote-image";
import type { ChatDisplayPreferences } from "@mobile/features/settings/capabilities/chat-display-settings";
import type {
  ChatCosmeticBadge,
  ChatEmote,
  ChatUserCosmetics,
} from "../capabilities/chat-interactions";
import type { WatchChatMessage } from "../capabilities/watch-chat";
import { resolveMessageParts } from "../domain/message-parts";
import { formatMessageTimestamp } from "../domain/message-timestamp";
import { resolveChatUsernameColor } from "../domain/resolve-chat-username-color";
import { ChatUsername } from "./chat-username";

const replacesRole = (badge: ChatCosmeticBadge, role: string) =>
  badge.replaces === role ||
  (badge.replaces === "moderator" && role === "lead_moderator");

export const ChatMessageRow = memo(function ChatMessageRow({
  message,
  platform,
  emotes,
  preferences,
  cosmetics,
  roleBadges,
  onSelect,
}: {
  readonly message: WatchChatMessage;
  readonly platform: Platform;
  readonly emotes: readonly ChatEmote[];
  readonly preferences: ChatDisplayPreferences;
  readonly cosmetics?: ChatUserCosmetics | undefined;
  readonly roleBadges?: readonly ChatCosmeticBadge[] | undefined;
  readonly onSelect: (message: WatchChatMessage) => void;
}) {
  const { t } = useTranslation();
  const font = {
    fontSize: preferences.fontSizePx,
    lineHeight: Math.round(preferences.fontSizePx * 1.4),
  };
  const notice = message.kind === "notice";
  const deleted = message.deletedAt !== undefined;
  const parts = useMemo(
    () =>
      resolveMessageParts(message.text, emotes, message.parts, {
        animatedEmotes: preferences.animatedEmotes,
        overlayEmotes: preferences.overlayEmotes,
        renderEmotesAsText: notice && !preferences.systemMessageEmotes,
      }),
    [
      message.text,
      message.parts,
      emotes,
      preferences.animatedEmotes,
      preferences.overlayEmotes,
      preferences.systemMessageEmotes,
      notice,
    ],
  );
  const badges = useMemo(
    () =>
      [
        ...(cosmetics?.badges ?? []),
        ...(roleBadges ?? []).filter(
          (badge) =>
            message.badges.some((official) =>
              replacesRole(badge, official.setId),
            ) &&
            !cosmetics?.badges.some(
              (assigned) =>
                assigned.provider === "ffz" &&
                assigned.replaces === badge.replaces,
            ),
        ),
      ].filter((badge) =>
        badge.provider === "7tv"
          ? preferences.enable7tvBadges
          : badge.provider === "bttv"
            ? preferences.enableBttvBadges
            : preferences.enableFfzBadges,
      ),
    [
      cosmetics,
      roleBadges,
      message.badges,
      preferences.enable7tvBadges,
      preferences.enableBttvBadges,
      preferences.enableFfzBadges,
    ],
  );
  if (notice && !preferences.showUserNotices && message.noticeKind !== "system")
    return null;
  if (deleted && !preferences.showClearMsg) return null;
  if (deleted && preferences.deletedMessageDisplay === "tombstone")
    return (
      <Text
        style={styles.tombstone}
        testID={`watch-chat-deleted-${message.id}`}
      >
        {t("chat.messageDeleted")}
      </Text>
    );
  const timestamp = preferences.timestamps
    ? formatMessageTimestamp(message, preferences.timestampFormat)
    : null;
  const color = resolveChatUsernameColor({
    ...(message.color === undefined ? {} : { color: message.color }),
    platform,
    readableColorForUncolored: preferences.readableColorForUncolored,
    themeAdaptUsernameColor: preferences.themeAdaptUsernameColor,
    username: message.username || message.displayName,
  });
  const highlight =
    !notice && message.firstMessage && preferences.firstMsgHighlight;
  const framedDeletion =
    deleted &&
    preferences.deletedMessageDisplay !== "message" &&
    preferences.moderationHighlightStyle === "cozy";
  const deletionDetail =
    deleted && preferences.deletedMessageDisplay === "audit"
      ? `${t("chat.messageDeleted")} ${t("chat.at")} ${new Date(message.deletedAt ?? 0).toLocaleTimeString()} ${t("chat.by")} ${message.deletedBy || "unknown moderator"}`
      : `${t("chat.messageDeleted")}${message.deletedBy ? ` ${t("chat.by")} ${message.deletedBy}` : ""}`;
  return (
    <View
      style={[
        styles.wrapper,
        highlight || notice || framedDeletion ? styles.highlight : null,
      ]}
      testID={`watch-chat-row-${message.id}`}
    >
      {highlight ? (
        <Text style={styles.eventLabel}>
          {t("settings.firstMessageFromANewChatter", {
            defaultValue: "First message from a new chatter",
          })}
        </Text>
      ) : null}
      {deleted && preferences.deletedMessageDisplay !== "message" ? (
        <Text
          style={styles.eventLabel}
          testID={`watch-chat-deletion-detail-${message.id}`}
        >
          {deletionDetail}
        </Text>
      ) : null}
      <Pressable
        onLongPress={notice ? undefined : () => onSelect(message)}
        style={[
          styles.messageRow,
          {
            paddingVertical:
              preferences.density === "compact"
                ? 0
                : preferences.density === "loose"
                  ? 4
                  : 2,
          },
        ]}
        testID={`watch-chat-message-${message.id}`}
      >
        {timestamp ? (
          <Text
            style={styles.timestamp}
            testID={`watch-chat-time-${message.id}`}
          >
            {timestamp}{" "}
          </Text>
        ) : null}
        {message.displayName ? (
          <View
            style={styles.messageChrome}
            testID={`watch-chat-chrome-${message.id}`}
          >
            {message.badges
              .filter(
                (badge) =>
                  !badges.some((cosmetic) =>
                    replacesRole(cosmetic, badge.setId),
                  ),
              )
              .map((badge) =>
                badge.imageUrl ? (
                  <Image
                    key={`${badge.setId}-${badge.version}`}
                    accessibilityLabel={badge.title}
                    resizeMode="contain"
                    source={{ uri: badge.imageUrl }}
                    style={styles.badge}
                    testID={`watch-chat-badge-${message.id}-${badge.setId}`}
                  />
                ) : null,
              )}
            {badges.map((badge) => (
              <View
                key={`${badge.provider}:${badge.id}`}
                style={
                  badge.color
                    ? { backgroundColor: badge.color, borderRadius: 2 }
                    : undefined
                }
              >
                <Image
                  accessibilityLabel={badge.title}
                  resizeMode="contain"
                  source={{ uri: badge.imageUrl }}
                  style={styles.badge}
                  testID={`watch-chat-cosmetic-${message.id}-${badge.provider}-${badge.id}`}
                />
              </View>
            ))}
            <Pressable
              accessibilityLabel={`Actions for ${message.displayName}`}
              accessibilityRole="button"
              disabled={notice}
              onPress={() => onSelect(message)}
              hitSlop={8}
            >
              <ChatUsername
                name={message.displayName}
                fontSize={preferences.fontSizePx}
                bold={preferences.boldUsernames}
                color={color}
                id={message.id}
                style={styles.name}
                {...(preferences.enable7tvUsernamePaints && cosmetics?.paint
                  ? { paint: cosmetics.paint }
                  : {})}
              />
            </Pressable>
          </View>
        ) : null}
        {message.displayName ? (
          <Text style={[styles.messageText, font]}>{": "}</Text>
        ) : null}
        {parts.map((part, index) =>
          part.kind === "text" ? (
            <Text
              key={index}
              selectable
              style={[
                styles.messageText,
                font,
                deleted ? styles.deleted : null,
              ]}
            >
              {part.text}
            </Text>
          ) : part.kind === "emote-stack" ? (
            <View
              key={index}
              style={{
                width: preferences.emoteSizePx,
                height: preferences.emoteSizePx,
              }}
              testID={`watch-chat-overlay-${message.id}-${index}`}
            >
              {part.emotes.map((emote, layer) => (
                <MobileEmoteImage
                  key={layer}
                  name={emote.text}
                  uri={emote.imageUrl}
                  animated={preferences.animatedEmotes}
                  style={{
                    position: "absolute",
                    width: preferences.emoteSizePx,
                    height: preferences.emoteSizePx,
                  }}
                />
              ))}
            </View>
          ) : (
            <MobileEmoteImage
              key={index}
              name={part.text}
              uri={part.imageUrl}
              animated={preferences.animatedEmotes}
              style={{
                width: preferences.emoteSizePx,
                height: preferences.emoteSizePx,
              }}
            />
          ),
        )}
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrapper: { paddingVertical: 2 },
  highlight: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderWidth: 1,
    borderRadius: mobileRadii.medium,
    padding: 8,
  },
  eventLabel: { ...mobileType.caption, color: mobileColors.textSecondary },
  tombstone: {
    ...mobileType.body,
    color: mobileColors.textSecondary,
    fontStyle: "italic",
    paddingVertical: 4,
  },
  deleted: {
    color: mobileColors.textSecondary,
    textDecorationLine: "line-through",
  },
  messageRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  messageChrome: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: {
    ...mobileType.body,
    includeFontPadding: false,
    transform: [{ translateY: -1 }],
  },
  timestamp: { ...mobileType.caption, color: mobileColors.textSecondary },
  messageText: { ...mobileType.body, color: mobileColors.textPrimary },
  badge: { width: 18, height: 18 },
});
