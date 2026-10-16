import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AtSign,
  Ban,
  Copy,
  CornerUpLeft,
  ArrowRight,
  Flag,
  Shield,
} from "lucide-react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileAvatar } from "@mobile/design/avatar";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
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
import type {
  ChatCosmeticBadge,
  ChatEmote,
  ChatUserCosmetics,
} from "../capabilities/chat-interactions";
import type { ChatDisplayPreferences } from "@mobile/features/settings/capabilities/chat-display-settings";
import { selectUserChatMessages } from "../domain/select-user-chat-messages";
import { KickBadgeImage } from "./kick-badge-image";
import { ChatMessageRow } from "./chat-message-row";

type Action = {
  readonly label: string;
  readonly testID: string;
  readonly onPress: () => void;
  readonly icon: ComponentType<{ color: string; size: number }>;
  readonly tone?: "platform" | "danger" | "primary";
};

export function ChatUserSheet({
  selected,
  messages,
  platform,
  presentation,
  canCompose,
  canReply,
  emotes,
  preferences,
  cosmetics,
  roleBadges,
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
  readonly emotes: readonly ChatEmote[];
  readonly preferences: ChatDisplayPreferences;
  readonly cosmetics?: ReadonlyMap<string, ChatUserCosmetics>;
  readonly roleBadges?: readonly ChatCosmeticBadge[];
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
    useState<Awaited<ReturnType<NonNullable<ChatPresentation["readChannel"]>>>>(
      null,
    );
  const [profileStatus, setProfileStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [notice, setNotice] = useState("");
  const historyScroll = useRef<ScrollView>(null);
  const historyPositioned = useRef(false);
  const selectedRowLayout = useRef<{
    readonly y: number;
    readonly height: number;
  } | null>(null);
  const historyHeight = useRef<number | null>(null);
  const historyContentHeight = useRef<number | null>(null);
  const positionSelectedRow = () => {
    if (
      historyPositioned.current ||
      !selectedRowLayout.current ||
      historyHeight.current === null ||
      historyContentHeight.current === null ||
      !historyScroll.current
    )
      return;
    const { y, height } = selectedRowLayout.current;
    historyScroll.current.scrollTo({
      y: Math.min(
        Math.max(
          0,
          y + Math.min(height, historyHeight.current) - historyHeight.current,
        ),
        Math.max(0, historyContentHeight.current - historyHeight.current),
      ),
      animated: false,
    });
    historyPositioned.current = true;
  };
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
        const login = username?.trim().toLowerCase();
        const sameLogin = Boolean(
          login && channel?.username.trim().toLowerCase() === login,
        );
        const sameUser =
          platform === "kick" || !userId ? sameLogin : channel?.id === userId;
        if (channel && sameUser) {
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
      ? [
          {
            label: "Reply",
            testID: "chat-reply",
            onPress: onReply,
            icon: CornerUpLeft,
          },
        ]
      : []),
    ...(canCompose && selected.deletedAt === undefined
      ? [
          {
            label: "Copy to chat",
            testID: "chat-copy-to-chat",
            onPress: onCopyToChat,
            icon: Copy,
          },
        ]
      : []),
    ...(canCompose && username
      ? [
          {
            label: "Mention",
            testID: "chat-mention",
            onPress: onMention,
            icon: AtSign,
          },
        ]
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
            icon: ArrowRight,
            tone: "platform" as const,
          },
        ]
      : []),
    ...(onBlock
      ? [
          {
            label: platform === "kick" ? "Block on Kick" : "Block user",
            testID: "chat-block",
            onPress: onBlock,
            icon: Ban,
            tone: "danger" as const,
          },
        ]
      : []),
    ...(onReport
      ? [
          {
            label: "Report on platform",
            testID: "chat-report",
            onPress: onReport,
            icon: Flag,
            tone: "danger" as const,
          },
        ]
      : []),
    ...(onModerate
      ? [
          {
            label: "Moderate",
            testID: "chat-moderate",
            onPress: onModerate,
            icon: Shield,
          },
        ]
      : []),
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
  const hasOfficialPartnerBadge = selected.badges.some(
    (badge) =>
      Boolean(badge.imageUrl) &&
      (badge.setId === "partner" || badge.setId === "verified"),
  );
  return (
    <MobileBottomSheet
      visible
      variant="chat"
      size="expanded"
      title={selected.displayName}
      onDismiss={onDismiss}
      heading={
        <View style={styles.identity}>
          <MobileAvatar
            name={selected.displayName}
            size={48}
            uri={profile?.avatarUrl ?? null}
            livePlatform={profile?.isLive ? platform : null}
            testID="chat-user-avatar"
          />
          <View style={styles.identityCopy}>
            <View style={styles.nameRow}>
              <Text
                style={[mobileType.title, styles.nameText]}
                numberOfLines={2}
              >
                {profile?.displayName ?? selected.displayName}
              </Text>
              {selected.badges
                .filter((badge) => badge.imageUrl)
                .map((badge) =>
                  platform === "kick" ? (
                    <KickBadgeImage
                      key={`${badge.setId}-${badge.version}`}
                      imageUrl={badge.imageUrl}
                      title={badge.title}
                      testID={`chat-user-badge-${badge.setId}`}
                    />
                  ) : (
                    <Image
                      key={`${badge.setId}-${badge.version}`}
                      accessibilityLabel={badge.title}
                      resizeMode="contain"
                      source={{ uri: badge.imageUrl }}
                      style={styles.badge}
                      testID={`chat-user-badge-${badge.setId}`}
                    />
                  ),
                )}
              {!hasOfficialPartnerBadge &&
              (profile?.isPartner ||
                (platform === "kick" && profile?.isVerified)) ? (
                <View testID="chat-user-partner">
                  <MobileVerifiedBadge platform={platform} />
                </View>
              ) : null}
            </View>
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
      }
      footer={
        presentation ? (
          <>
            <SheetAction
              label="Copy message"
              testID="chat-copy-message"
              onPress={() => {
                void copyMessage();
              }}
              icon={Copy}
              tone="primary"
              disabled={selected.deletedAt !== undefined}
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
        <View style={styles.history}>
          <Text style={mobileType.label}>Recent messages</Text>
          <ScrollView
            ref={historyScroll}
            testID="chat-user-history-scroll"
            style={styles.historyScroll}
            contentContainerStyle={styles.historyContent}
            nestedScrollEnabled
            onLayout={(event) => {
              historyHeight.current = event.nativeEvent.layout.height;
              positionSelectedRow();
            }}
            onContentSizeChange={(_, height) => {
              historyContentHeight.current = height;
              positionSelectedRow();
            }}
          >
            {history.map((message) => (
              <View
                key={message.id}
                style={[
                  styles.historyRow,
                  message.id === selected.id ? styles.selected : null,
                ]}
                testID={`chat-user-message-${message.id}`}
                onLayout={
                  message.id === selected.id
                    ? (event) => {
                        selectedRowLayout.current = event.nativeEvent.layout;
                        positionSelectedRow();
                      }
                    : undefined
                }
              >
                <ChatMessageRow
                  message={message}
                  platform={platform}
                  emotes={emotes}
                  preferences={preferences}
                  cosmetics={
                    message.userId ? cosmetics?.get(message.userId) : undefined
                  }
                  roleBadges={roleBadges}
                  selectOnPress
                  onSelect={(row) => {
                    if (row.deletedAt === undefined) onSelect(row);
                  }}
                />
              </View>
            ))}
          </ScrollView>
        </View>
        <View style={styles.actions}>
          {actions.map((action) => (
            <View key={action.testID} style={styles.actionCell}>
              <SheetAction {...action} platform={platform} />
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
  icon: Icon,
  tone,
  platform,
}: Action & {
  readonly disabled?: boolean;
  readonly platform?: Platform;
}) {
  const platformColor =
    platform === "kick" ? mobileColors.kick : mobileColors.twitch;
  const color =
    tone === "primary"
      ? chatSheetPrimaryText
      : tone === "platform" && platform === "kick"
        ? mobileColors.background
        : mobileColors.textPrimary;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        tone === "primary" ? styles.wide : null,
        tone === "platform" ? { backgroundColor: platformColor } : null,
        tone === "danger" ? styles.danger : null,
        disabled ? styles.disabled : null,
      ]}
      testID={testID}
    >
      <Icon color={color} size={18} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
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
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  nameText: { flexShrink: 1 },
  badge: { width: 18, height: 18 },
  history: { gap: mobileSpacing.xSmall },
  historyScroll: { height: 200 },
  historyContent: { flexGrow: 1, justifyContent: "flex-end" },
  historyRow: {
    paddingHorizontal: mobileSpacing.small,
  },
  selected: { backgroundColor: "rgba(22,53,132,0.5)" },
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
    flexDirection: "row",
    gap: mobileSpacing.small,
    padding: mobileSpacing.small,
    borderRadius: mobileRadii.full,
    backgroundColor: "#29272e",
  },
  wide: { backgroundColor: "#B5C4FF" },
  danger: { backgroundColor: mobileColors.danger },
  disabled: { opacity: 0.5 },
  actionText: {
    ...mobileType.label,
    color: mobileColors.textPrimary,
    textAlign: "center",
    flexShrink: 1,
  },
});

const chatSheetPrimaryText = "#1D1B20";
