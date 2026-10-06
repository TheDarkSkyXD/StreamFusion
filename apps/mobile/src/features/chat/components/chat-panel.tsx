import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileButton } from "@mobile/design/button";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileTextField } from "@mobile/design/text-input";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type {
  ChatInteractions,
  ChatInteractionView,
} from "../capabilities/chat-interactions";
import type {
  WatchChatAvailability,
  WatchChatConnectInput,
  WatchChatMessage,
} from "../capabilities/watch-chat";
import { resolveMessageParts } from "../domain/message-parts";
import { resolveChatUsernameColor } from "../domain/resolve-chat-username-color";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@mobile/features/settings/domain/chat-display-preferences";

const READ_ONLY: ChatInteractionView = {
  access: "blocked",
  detail: "Sign in to send messages.",
  sending: false,
  emotes: [],
  emoteStatus: "ready",
  emoteDetail: "",
};
const noopSubscribe = () => () => undefined;

export function ChatPanel(props: Parameters<typeof ChatPanelBody>[0]) {
  const identity = JSON.stringify([
    props.platform,
    props.target?.platform,
    props.target?.channelId,
    props.target?.channelName,
    props.recorded ?? false,
  ]);
  return <ChatPanelBody key={identity} {...props} />;
}

function ChatPanelBody({
  chat,
  platform,
  interactions,
  target,
  recorded = false,
  readOnly = false,
  onRetry,
  onModerateMessage,
  testID = "watch-chat",
  title = "Chat",
}: {
  readonly chat: WatchChatAvailability;
  readonly platform: Platform;
  readonly interactions?: ChatInteractions;
  readonly target?: WatchChatConnectInput;
  readonly recorded?: boolean;
  readonly readOnly?: boolean;
  readonly onRetry?: () => void;
  readonly onModerateMessage?: (message: WatchChatMessage) => void;
  readonly testID?: string;
  readonly title?: string;
}) {
  const view = useSyncExternalStore(
    interactions
      ? (listener) => interactions.subscribe(listener)
      : noopSubscribe,
    interactions ? () => interactions.snapshot() : () => READ_ONLY,
  );
  const [draft, setDraft] = useState("");
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const composerEpoch = useRef(0);
  const [reply, setReply] = useState<WatchChatMessage | null>(null);
  const [selected, setSelected] = useState<WatchChatMessage | null>(null);
  const [picker, setPicker] = useState(false);
  const [query, setQuery] = useState("");
  const list = useRef<ScrollView>(null);
  const followsBottom = useRef(true);
  const channelId = target?.channelId;
  const channelName = target?.channelName;
  const targetPlatform = target?.platform;
  useEffect(() => {
    composerEpoch.current += 1;
    if (
      !interactions ||
      channelId === undefined ||
      channelName === undefined ||
      targetPlatform === undefined
    )
      return;
    interactions.attach(
      { channelId, channelName, platform: targetPlatform },
      recorded,
    );
    return () => {
      composerEpoch.current += 1;
      interactions.dispose();
    };
  }, [interactions, recorded, channelId, channelName, targetPlatform]);
  const send = async () => {
    if (!interactions) return;
    const epoch = composerEpoch.current;
    const sentDraft = draft;
    setSendNotice(null);
    const result = await interactions.send(sentDraft, reply?.id);
    if (result.kind === "uncertain")
      setSendNotice(`Message to ${channelName}: ${result.detail}`);
    if (result.kind === "sent") {
      if (epoch !== composerEpoch.current) {
        setSendNotice(`Message sent to ${channelName}.`);
        return;
      }
      setDraft((currentDraft) =>
        currentDraft === sentDraft ? "" : currentDraft,
      );
      setReply(null);
    }
  };
  const messages = chat.kind === "live" ? chat.messages : [];
  const matches = view.emotes
    .filter((emote) =>
      emote.name.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 60);
  return (
    <View style={styles.panel} testID={testID}>
      <Text selectable style={mobileType.title}>
        {title}
      </Text>
      {chat.kind !== "live" ? (
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={mobileType.body}
        >
          {chat.detail}
        </Text>
      ) : null}
      {chat.kind === "failed" && onRetry ? (
        <MobileButton
          accessibilityLabel="Retry chat"
          onPress={onRetry}
          testID={`${testID}-retry`}
          variant="secondary"
        >
          Retry
        </MobileButton>
      ) : null}
      <ScrollView
        ref={list}
        style={styles.messages}
        contentContainerStyle={styles.messageList}
        testID={`${testID}-scroll`}
        scrollEventThrottle={100}
        onScroll={({ nativeEvent }) => {
          followsBottom.current =
            nativeEvent.contentOffset.y +
              nativeEvent.layoutMeasurement.height >=
            nativeEvent.contentSize.height - 40;
        }}
        onContentSizeChange={() => {
          if (followsBottom.current)
            list.current?.scrollToEnd({ animated: false });
        }}
      >
        {messages.map((message) => (
          <Pressable
            key={message.id}
            onLongPress={() => setSelected(message)}
            style={styles.messageRow}
            testID={`watch-chat-message-${message.id}`}
          >
            <View
              style={styles.messageChrome}
              testID={`watch-chat-chrome-${message.id}`}
            >
              {message.badges.map((badge) =>
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
              <Pressable
                accessibilityLabel={`Actions for ${message.displayName}`}
                accessibilityRole="button"
                onPress={() => setSelected(message)}
                hitSlop={8}
              >
                <Text
                  style={[
                    styles.name,
                    {
                      color: resolveChatUsernameColor({
                        ...(message.color === undefined
                          ? {}
                          : { color: message.color }),
                        platform,
                        readableColorForUncolored:
                          DEFAULT_CHAT_DISPLAY_PREFERENCES.readableColorForUncolored,
                        themeAdaptUsernameColor:
                          DEFAULT_CHAT_DISPLAY_PREFERENCES.themeAdaptUsernameColor,
                        username: message.username || message.displayName,
                      }),
                    },
                  ]}
                  testID={`watch-chat-username-${message.id}`}
                >
                  {message.displayName}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.messageText}>{": "}</Text>
            {resolveMessageParts(message.text, view.emotes, message.parts).map(
              (part, index) =>
                part.kind === "text" ? (
                  <Text key={index} selectable style={styles.messageText}>
                    {part.text}
                  </Text>
                ) : (
                  <Image
                    key={index}
                    accessibilityLabel={part.text}
                    source={{ uri: part.imageUrl }}
                    style={styles.emote}
                    resizeMode="contain"
                  />
                ),
            )}
          </Pressable>
        ))}
      </ScrollView>
      {selected ? (
        <MobileBottomSheet
          visible
          title={selected.displayName}
          onDismiss={() => setSelected(null)}
        >
          <View style={styles.menu} testID="chat-user-actions">
            <View style={styles.actions}>
              {!recorded && !readOnly ? (
                <MobileButton
                  accessibilityLabel="Reply to message"
                  disabled={view.access !== "ready"}
                  onPress={() => {
                    setReply(selected);
                    setSelected(null);
                  }}
                  testID="chat-reply"
                  variant="secondary"
                >
                  Reply
                </MobileButton>
              ) : null}
              {!recorded && !readOnly ? (
                <MobileButton
                  accessibilityLabel="Mention user"
                  onPress={() => {
                    setDraft(
                      (value) =>
                        `${value}${value ? " " : ""}@${selected.username ?? selected.displayName} `,
                    );
                    setSelected(null);
                  }}
                  testID="chat-mention"
                  variant="secondary"
                >
                  Mention
                </MobileButton>
              ) : null}
              {interactions && !readOnly ? (
                <MobileButton
                  accessibilityLabel={
                    platform === "kick" ? "Block on Kick" : "Block user"
                  }
                  onPress={() => {
                    void interactions.userAction(selected, "block");
                    setSelected(null);
                  }}
                  testID="chat-block"
                  variant="secondary"
                >
                  {platform === "kick" ? "Block on Kick" : "Block user"}
                </MobileButton>
              ) : null}
              {interactions ? (
                <MobileButton
                  accessibilityLabel="Report on platform"
                  onPress={() => {
                    void interactions.userAction(selected, "report");
                    setSelected(null);
                  }}
                  testID="chat-report"
                  variant="secondary"
                >
                  Report on platform
                </MobileButton>
              ) : null}
              {onModerateMessage && !readOnly ? (
                <MobileButton
                  accessibilityLabel="Open moderation for user"
                  onPress={() => {
                    onModerateMessage(selected);
                    setSelected(null);
                  }}
                  testID="chat-moderate"
                  variant="secondary"
                >
                  Moderate
                </MobileButton>
              ) : null}
              <MobileButton
                accessibilityLabel="Close user actions"
                onPress={() => setSelected(null)}
                testID="chat-user-close"
                variant="ghost"
              >
                Close
              </MobileButton>
            </View>
          </View>
        </MobileBottomSheet>
      ) : null}
      {recorded && interactions ? (
        <Text accessibilityLiveRegion="polite" style={mobileType.caption}>
          {view.detail}
        </Text>
      ) : null}
      {!recorded && !readOnly ? (
        <View style={styles.composer} testID="chat-composer">
          {reply ? (
            <Pressable
              onPress={() => setReply(null)}
              accessibilityLabel="Cancel reply"
            >
              <Text
                style={mobileType.caption}
              >{`Replying to ${reply.displayName}. Tap to cancel.`}</Text>
            </Pressable>
          ) : null}
          <Text accessibilityLiveRegion="polite" style={mobileType.caption}>
            {view.detail}
          </Text>
          {sendNotice ? (
            <Text
              accessibilityLiveRegion="polite"
              style={mobileType.caption}
              testID="chat-send-notice"
            >
              {sendNotice}
            </Text>
          ) : null}
          {picker ? (
            <MobileBottomSheet
              visible
              title="Emotes"
              size="expanded"
              onDismiss={() => setPicker(false)}
            >
              <View style={styles.menu} testID="chat-emote-picker">
                <MobileTextField
                  label="Search emotes"
                  placeholder="Search emotes"
                  value={query}
                  onChange={setQuery}
                  testID="chat-emote-search"
                />
                <Text style={mobileType.caption}>{view.emoteDetail}</Text>
                <ScrollView
                  style={styles.picker}
                  contentContainerStyle={styles.emoteGrid}
                >
                  {matches.map((emote) => (
                    <Pressable
                      key={`${emote.provider}:${emote.id}:${emote.name}`}
                      accessibilityLabel={`${emote.name} (${emote.provider})`}
                      accessibilityRole="button"
                      onPress={() => {
                        setDraft(
                          (value) =>
                            `${value}${value ? " " : ""}${emote.insertion} `,
                        );
                        setPicker(false);
                      }}
                      style={styles.emoteChoice}
                    >
                      <Image
                        accessibilityLabel={emote.name}
                        source={{ uri: emote.imageUrl }}
                        style={styles.emote}
                      />
                      <Text style={mobileType.caption}>{emote.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            </MobileBottomSheet>
          ) : null}
          <TextInput
            accessibilityLabel="Chat message"
            editable={view.access === "ready" && !view.sending}
            multiline
            maxLength={1000}
            placeholder={
              view.access === "ready"
                ? "Send a message"
                : "Connect an account to chat"
            }
            placeholderTextColor={mobileColors.textSecondary}
            value={draft}
            onChangeText={setDraft}
            style={styles.input}
            testID="chat-draft"
          />
          <View style={styles.actions}>
            <MobileButton
              accessibilityLabel={picker ? "Close emotes" : "Open emotes"}
              onPress={() => setPicker((value) => !value)}
              testID="chat-emotes"
              variant="secondary"
            >
              {picker ? "Close emotes" : "Emotes"}
            </MobileButton>
            <MobileButton
              accessibilityLabel="Send chat message"
              busy={view.sending}
              disabled={view.access !== "ready" || !draft.trim()}
              onPress={() => {
                void send();
              }}
              testID="chat-send"
              variant="primary"
            >
              Send
            </MobileButton>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, minHeight: 0, gap: mobileSpacing.small },
  messages: { flex: 1, minHeight: 0 },
  messageList: {
    gap: mobileSpacing.xSmall,
    paddingBottom: mobileSpacing.small,
  },
  messageRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  messageChrome: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: {
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    includeFontPadding: false,
    transform: [{ translateY: -1 }],
  },
  messageText: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 22,
  },
  badge: { width: 18, height: 18 },
  emote: { width: 28, height: 28 },
  composer: { gap: mobileSpacing.xSmall, paddingBottom: mobileSpacing.small },
  input: {
    ...mobileType.body,
    color: mobileColors.textPrimary,
    minHeight: 44,
    maxHeight: 100,
    padding: mobileSpacing.small,
    backgroundColor: mobileColors.surface,
    borderWidth: 1,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  menu: {
    backgroundColor: mobileColors.surfaceRaised,
    padding: mobileSpacing.small,
    gap: mobileSpacing.small,
    borderRadius: mobileRadii.medium,
  },
  picker: { maxHeight: 160 },
  emoteGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  emoteChoice: {
    alignItems: "center",
    minWidth: 56,
    minHeight: 44,
    maxWidth: 100,
  },
});
