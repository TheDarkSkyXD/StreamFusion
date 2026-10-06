import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import type { Platform } from "@streamfusion/core/platform";
import { MobileButton } from "@mobile/design/button";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileTextField } from "@mobile/design/text-input";
import { MobileEmoteImage } from "@mobile/design/emote-image";
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
import { ChatMessageRow } from "./chat-message-row";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@mobile/features/settings/domain/chat-display-preferences";

const READ_ONLY: ChatInteractionView = {
  access: "blocked",
  detail: "Sign in to send messages.",
  sending: false,
  emotes: [],
  emoteStatus: "ready",
  emoteDetail: "",
};
const EMPTY_MESSAGES: readonly WatchChatMessage[] = [];
const noopSubscribe = () => () => undefined;

export function ChatPanel(props: Parameters<typeof ChatPanelBody>[0]) {
  const identity = JSON.stringify([
    props.platform,
    props.target?.platform,
    props.target?.channelId,
    props.target?.channelName,
    props.target?.media?.id,
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
  engagementHeader,
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
  readonly engagementHeader?: ReactNode;
}) {
  const view = useSyncExternalStore(
    interactions
      ? (listener) => interactions.subscribe(listener)
      : noopSubscribe,
    interactions ? () => interactions.snapshot() : () => READ_ONLY,
  );
  const { t } = useTranslation();
  const list = useRef<FlatList<WatchChatMessage>>(null);
  const readingGesture = useRef(false);
  const [pausedMessages, setPausedMessages] = useState<
    readonly WatchChatMessage[] | null
  >(null);
  const preferences =
    view.displayPreferences ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
  const [draft, setDraft] = useState("");
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const composerEpoch = useRef(0);
  const [reply, setReply] = useState<WatchChatMessage | null>(null);
  const [selected, setSelected] = useState<WatchChatMessage | null>(null);
  const [picker, setPicker] = useState(false);
  const [pickerMessages, setPickerMessages] =
    useState<readonly WatchChatMessage[]>(EMPTY_MESSAGES);
  const [query, setQuery] = useState("");
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
  const messages = chat.kind === "live" ? chat.messages : EMPTY_MESSAGES;
  const visibleMessages =
    pausedMessages ?? (picker ? pickerMessages : messages);
  const newestFirst = useMemo(
    () => [...visibleMessages].reverse(),
    [visibleMessages],
  );
  const emotes = useMemo(
    () =>
      view.emotes.filter((emote) =>
        emote.provider === "7tv"
          ? preferences.enable7tv
          : emote.provider === "bttv"
            ? preferences.enableBttv
            : emote.provider === "ffz"
              ? preferences.enableFfz
              : true,
      ),
    [
      view.emotes,
      preferences.enable7tv,
      preferences.enableBttv,
      preferences.enableFfz,
    ],
  );
  const matches = useMemo(
    () =>
      picker
        ? emotes
            .filter((emote) =>
              emote.name.toLowerCase().includes(query.trim().toLowerCase()),
            )
            .slice(0, 60)
        : [],
    [emotes, picker, query],
  );
  const renderMessage = useCallback(
    ({ item }: { readonly item: WatchChatMessage }) => (
      <ChatMessageRow
        message={item}
        platform={platform}
        emotes={emotes}
        preferences={preferences}
        cosmetics={item.userId ? view.cosmetics?.get(item.userId) : undefined}
        roleBadges={view.cosmeticRoleBadges}
        onSelect={setSelected}
      />
    ),
    [platform, emotes, preferences, view.cosmetics, view.cosmeticRoleBadges],
  );
  const onVisibleMessages = useCallback(
    (event: {
      readonly viewableItems: readonly { readonly item: WatchChatMessage }[];
    }) => {
      interactions?.loadCosmetics?.(
        event.viewableItems.flatMap(({ item }) =>
          item.userId ? [item.userId] : [],
        ),
      );
    },
    [interactions],
  );
  const moderationRevision =
    chat.kind === "live" || chat.kind === "empty"
      ? (chat.moderationRevision ?? 0)
      : 0;
  const replayLoading = recorded && chat.kind === "connecting";
  const messageMetadataRevision =
    chat.kind === "live" || chat.kind === "empty"
      ? (chat.messageMetadataRevision ?? 0)
      : 0;
  const [appliedSource, setAppliedSource] = useState({
    moderationRevision,
    messageMetadataRevision,
    replayLoading,
  });
  if (
    appliedSource.moderationRevision !== moderationRevision ||
    appliedSource.messageMetadataRevision !== messageMetadataRevision ||
    appliedSource.replayLoading !== replayLoading
  ) {
    setAppliedSource({
      moderationRevision,
      messageMetadataRevision,
      replayLoading,
    });
    if (replayLoading) {
      setPausedMessages(null);
      setPickerMessages(EMPTY_MESSAGES);
      setSelected(null);
      setReply(null);
    } else {
      const moderated = appliedSource.moderationRevision !== moderationRevision;
      const current = new Map(messages.map((message) => [message.id, message]));
      const reconcile = (held: readonly WatchChatMessage[]) =>
        held.flatMap((message) => {
          const updated = current.get(message.id);
          return updated ? [updated] : moderated ? [] : [message];
        });
      setPausedMessages((held) => (held ? reconcile(held) : null));
      setPickerMessages(reconcile);
      const reconcileSelection = (held: WatchChatMessage | null) => {
        const updated = held ? current.get(held.id) : undefined;
        return updated
          ? updated.deletedAt === undefined
            ? updated
            : null
          : moderated
            ? null
            : held;
      };
      setSelected(reconcileSelection);
      setReply(reconcileSelection);
    }
  }
  const handleScroll = useCallback(
    (event: {
      readonly nativeEvent: { readonly contentOffset: { readonly y: number } };
    }) => {
      const readingHistory = event.nativeEvent.contentOffset.y > 24;
      if (readingGesture.current || !readingHistory)
        setPausedMessages((previous) =>
          readingHistory ? (previous ?? messages) : null,
        );
    },
    [messages],
  );
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
          Retry chat
        </MobileButton>
      ) : null}
      {engagementHeader}
      {(chat.kind === "live" || chat.kind === "empty") && chat.historyDetail ? (
        <Text
          accessibilityLiveRegion="polite"
          style={mobileType.caption}
          testID="chat-history-detail"
        >
          {chat.historyDetail}
        </Text>
      ) : null}
      <FlatList
        ref={list}
        onViewableItemsChanged={onVisibleMessages}
        onScroll={handleScroll}
        onScrollBeginDrag={() => {
          readingGesture.current = true;
        }}
        onScrollEndDrag={() => {
          readingGesture.current = false;
        }}
        scrollEventThrottle={64}
        style={styles.messages}
        contentContainerStyle={styles.messageList}
        testID={`${testID}-scroll`}
        inverted
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 24,
        }}
        data={newestFirst}
        keyExtractor={(message) => message.id}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={3}
        renderItem={renderMessage}
      />
      {pausedMessages ? (
        <MobileButton
          accessibilityLabel={t("chat.chatPausedDueToScroll")}
          testID="chat-resume"
          variant="secondary"
          onPress={() => {
            readingGesture.current = false;
            setPausedMessages(null);
            list.current?.scrollToOffset({ offset: 0, animated: false });
          }}
        >
          {t("chat.chatPausedDueToScroll")}
        </MobileButton>
      ) : null}
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
          {view.cosmeticsDetail ? (
            <Text
              accessibilityLiveRegion="polite"
              style={mobileType.caption}
              testID="chat-cosmetics-detail"
            >
              {view.cosmeticsDetail}
            </Text>
          ) : null}
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
                  placeholder="Search emotes..."
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
                      <MobileEmoteImage
                        name={emote.name}
                        uri={
                          preferences.animatedEmotes
                            ? (emote.animatedImageUrl ?? emote.imageUrl)
                            : (emote.staticImageUrl ?? emote.imageUrl)
                        }
                        animated={preferences.animatedEmotes}
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
              view.access === "ready" ? "Send a message..." : "Log in to chat"
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
              onPress={() => {
                setPickerMessages(messages);
                setPicker((value) => !value);
              }}
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
