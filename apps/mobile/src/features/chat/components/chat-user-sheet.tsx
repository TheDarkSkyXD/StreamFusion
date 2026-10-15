import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileAvatar } from "@mobile/design/avatar";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { ChatPresentation } from "../capabilities/chat-presentation";
import type { WatchChatMessage } from "../capabilities/watch-chat";
import { selectUserChatMessages } from "../domain/select-user-chat-messages";

type Action = {
  readonly label: string;
  readonly testID: string;
  readonly onPress: () => void;
};

export function ChatUserSheet({
  selected,
  messages,
  platform,
  presentation,
  canCompose,
  canReply,
  onSelect,
  onDismiss,
  onReply,
  onCopyToChat,
  onMention,
  onBlock,
  onReport,
  onModerate,
}: {
  readonly selected: WatchChatMessage;
  readonly messages: readonly WatchChatMessage[];
  readonly platform: Platform;
  readonly presentation?: ChatPresentation;
  readonly canCompose: boolean;
  readonly canReply: boolean;
  readonly onSelect: (message: WatchChatMessage) => void;
  readonly onDismiss: () => void;
  readonly onReply: () => void;
  readonly onCopyToChat: () => void;
  readonly onMention: () => void;
  readonly onBlock?: () => void;
  readonly onReport?: () => void;
  readonly onModerate?: () => void;
}) {
  const [profile, setProfile] =
    useState<Awaited<ReturnType<NonNullable<ChatPresentation["readChannel"]>>>>(null);
  const [profileStatus, setProfileStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [notice, setNotice] = useState("");
  const userId = selected.userId;
  const username = selected.username;
  const readChannel = presentation?.readChannel;
  const viewChannel = presentation?.viewChannel;
  useEffect(() => {
    if (!readChannel || (!userId && !username)) return;
    const controller = new AbortController();
    setProfile(null);
    setProfileStatus("loading");
    void readChannel(
      { platform, id: userId ?? "", username: username ?? "" },
      controller.signal,
    )
      .then((channel) => {
        if (controller.signal.aborted) return;
        if (channel && (!userId || channel.id === userId)) {
          setProfile(channel);
          setProfileStatus("ready");
        } else {
          setProfileStatus("unavailable");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setProfileStatus("unavailable");
      });
    return () => controller.abort();
  }, [readChannel, platform, userId, username]);
  const history = useMemo(
    () => selectUserChatMessages(selected, messages),
    [selected, messages],
  );
  const actions: Action[] = [
    ...(canReply
      ? [{ label: "Reply", testID: "chat-reply", onPress: onReply }]
      : []),
    ...(canCompose && selected.deletedAt === undefined
      ? [
          {
            label: "Copy to chat",
            testID: "chat-copy-to-chat",
            onPress: onCopyToChat,
          },
        ]
      : []),
    ...(canCompose && username
      ? [{ label: "Mention", testID: "chat-mention", onPress: onMention }]
      : []),
    ...(profile && viewChannel
      ? [
          {
            label: "View channel",
            testID: "chat-view-channel",
            onPress: () => {
              viewChannel({
                platform,
                id: profile.id,
                username: profile.username,
              });
              onDismiss();
            },
          },
        ]
      : []),
    ...(onBlock
      ? [
          {
            label: platform === "kick" ? "Block on Kick" : "Block user",
            testID: "chat-block",
            onPress: onBlock,
          },
        ]
      : []),
    ...(onReport
      ? [
          {
            label: "Report on platform",
            testID: "chat-report",
            onPress: onReport,
          },
        ]
      : []),
    ...(onModerate
      ? [{ label: "Moderate", testID: "chat-moderate", onPress: onModerate }]
      : []),
    { label: "Close", testID: "chat-user-close", onPress: onDismiss },
  ];
  const copyMessage = async () => {
    if (!presentation || selected.deletedAt !== undefined) return;
    try {
      await presentation.copyText(selected.text);
      setNotice("Message copied.");
    } catch {
      setNotice("Could not copy message.");
    }
  };
  return (
    <MobileBottomSheet
      visible
      title={selected.displayName}
      onDismiss={onDismiss}
      footer={
        presentation ? (
          <>
            <SheetAction
              label="Copy message"
              testID="chat-copy-message"
              onPress={() => {
                void copyMessage();
              }}
              disabled={selected.deletedAt !== undefined}
              wide
            />
            {notice ? (
              <Text accessibilityLiveRegion="polite" style={mobileType.caption}>
                {notice}
              </Text>
            ) : null}
          </>
        ) : undefined
      }
    >
      <View style={styles.body} testID="chat-user-actions">
        <View style={styles.identity}>
          <MobileAvatar
            name={selected.displayName}
            size={48}
            uri={profile?.avatarUrl ?? null}
            testID="chat-user-avatar"
          />
          <View style={styles.identityCopy}>
            <Text style={mobileType.title} numberOfLines={2}>
              {profile?.displayName ?? selected.displayName}
            </Text>
            {username ? (
              <Text style={mobileType.caption} numberOfLines={1}>
                @{profile?.username ?? username}
              </Text>
            ) : null}
            {profile?.createdAt ? (
              <Text style={mobileType.caption}>
                Joined {new Date(profile.createdAt).toLocaleDateString()}
              </Text>
            ) : null}
            {presentation && profileStatus === "unavailable" ? (
              <Text style={mobileType.caption}>
                Channel details unavailable
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.history}>
          <Text style={mobileType.label}>Recent messages</Text>
          <ScrollView style={styles.historyScroll} nestedScrollEnabled>
            {history.map((message) => (
              <Pressable
                key={message.id}
                accessibilityRole="button"
                accessibilityLabel={`Select message from ${selected.displayName}`}
                onPress={() => {
                  if (message.deletedAt === undefined) onSelect(message);
                }}
                style={[
                  styles.historyRow,
                  message.id === selected.id ? styles.selected : null,
                ]}
                testID={`chat-user-message-${message.id}`}
              >
                <Text style={mobileType.body}>
                  {message.deletedAt === undefined
                    ? message.text
                    : "Message deleted"}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
        <View style={styles.actions}>
          {actions.map((action) => (
            <View key={action.testID} style={styles.actionCell}>
              <SheetAction {...action} />
            </View>
          ))}
        </View>
      </View>
    </MobileBottomSheet>
  );
}

function SheetAction({
  label,
  testID,
  onPress,
  disabled = false,
  wide = false,
}: Action & {
  readonly disabled?: boolean;
  readonly wide?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        wide ? styles.wide : null,
        disabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      <Text style={[styles.actionText, wide ? styles.wideText : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { gap: mobileSpacing.medium },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: mobileSpacing.medium,
  },
  identityCopy: { flex: 1, minWidth: 0, gap: mobileSpacing.xSmall },
  history: { gap: mobileSpacing.xSmall },
  historyScroll: { maxHeight: 144 },
  historyRow: {
    padding: mobileSpacing.small,
    borderRadius: mobileRadii.medium,
  },
  selected: { backgroundColor: mobileColors.surfaceRaised },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  actionCell: { width: "48%", minWidth: 0, flexGrow: 1 },
  action: {
    width: "100%",
    minHeight: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    alignItems: "center",
    padding: mobileSpacing.small,
    borderRadius: mobileRadii.medium,
    backgroundColor: mobileColors.surfaceMuted,
  },
  wide: { backgroundColor: mobileColors.textPrimary },
  disabled: { opacity: 0.5 },
  actionText: {
    ...mobileType.label,
    color: mobileColors.textPrimary,
    textAlign: "center",
  },
  wideText: { color: mobileColors.background },
});
