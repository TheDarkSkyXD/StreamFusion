import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { ArrowDown, Smile } from "lucide-react-native";
import type { Platform } from "@streamfusion/core/platform";
import { MobileButton } from "@mobile/design/button";
import { MobileIconButton } from "@mobile/design/icon-button";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileTextField } from "@mobile/design/text-input";
import { MobileEmoteImage } from "@mobile/design/emote-image";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type {
  ChatEmote,
  ChatInteractions,
  ChatInteractionView,
} from "../capabilities/chat-interactions";
import type { ChatPresentation } from "../capabilities/chat-presentation";
import type {
  WatchChatAvailability,
  WatchChatConnectInput,
  WatchChatMessage,
} from "../capabilities/watch-chat";
import { ChatMessageRow } from "./chat-message-row";
import { ChatUserSheet } from "./chat-user-sheet";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@mobile/features/settings/domain/chat-display-preferences";
import { selectQuickEmotes } from "../domain/quick-emotes";
import { applyWatchChatModeration } from "../domain/apply-watch-chat-moderation";

const READ_ONLY: ChatInteractionView = {
  access: "blocked",
  detail: "Sign in to send messages.",
  sending: false,
  emotes: [],
  recentEmotes: [],
  emoteStatus: "ready",
  emoteDetail: "",
};
const EMPTY_MESSAGES: readonly WatchChatMessage[] = [];
const VISIBLE_POSITION_ANCHOR = { minIndexForVisible: 0 } as const;
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
  presentation,
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
  readonly presentation?: ChatPresentation;
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
  const readingGesture = useRef<"none" | "drag" | "coast" | "momentum">("none");
  const gestureMessages = useRef<readonly WatchChatMessage[]>(EMPTY_MESSAGES);
  const followFrame = useRef<number | null>(null);
  const [pausedMessages, setPausedMessages] = useState<
    readonly WatchChatMessage[] | null
  >(null);
  const preferences =
    view.displayPreferences ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
  const [draft, setDraft] = useState("");
  const input = useRef<TextInput>(null);
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
    pausedMessages ?? (picker || selected ? pickerMessages : messages);
  const visibleMessagesRef = useRef(visibleMessages);
  useLayoutEffect(() => {
    visibleMessagesRef.current = visibleMessages;
  }, [visibleMessages]);
  const newestFirst = useMemo(
    () => [...visibleMessages].reverse(),
    [visibleMessages],
  );
  const following = pausedMessages === null;
  const followingRef = useRef(following);
  const overlayRef = useRef(picker || selected !== null);
  const cancelFollow = useCallback(() => {
    if (followFrame.current !== null) cancelAnimationFrame(followFrame.current);
    followFrame.current = null;
  }, []);
  const requestFollow = useCallback(() => {
    if (followFrame.current !== null) return;
    if (
      !followingRef.current ||
      overlayRef.current ||
      readingGesture.current !== "none"
    )
      return;
    followFrame.current = requestAnimationFrame(() => {
      followFrame.current = null;
      if (
        followingRef.current &&
        !overlayRef.current &&
        readingGesture.current === "none"
      )
        list.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, []);
  useLayoutEffect(() => {
    followingRef.current = following;
    overlayRef.current = picker || selected !== null;
    if (overlayRef.current) cancelFollow();
  }, [following, picker, selected, cancelFollow]);
  useEffect(() => {
    requestFollow();
  }, [newestFirst, picker, selected, requestFollow]);
  useEffect(() => cancelFollow, [cancelFollow]);
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
  const quickEmotes = useMemo(
    () =>
      preferences.quickEmotes
        ? selectQuickEmotes(platform, emotes, view.recentEmotes)
        : [],
    [platform, emotes, view.recentEmotes, preferences.quickEmotes],
  );
  const sendQuickEmote = async (emote: ChatEmote) => {
    if (!interactions || view.access !== "ready" || view.sending) return;
    const epoch = composerEpoch.current;
    setSendNotice(null);
    const result = await interactions.send(emote.insertion);
    if (epoch !== composerEpoch.current) return;
    if (result.kind === "sent") interactions.rememberEmote(emote);
    if (result.kind === "uncertain")
      setSendNotice(`Message to ${channelName}: ${result.detail}`);
    input.current?.focus();
  };
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
        onSelect={(message) => {
          cancelFollow();
          overlayRef.current = true;
          setPickerMessages(visibleMessagesRef.current);
          setSelected(message);
        }}
      />
    ),
    [
      platform,
      emotes,
      preferences,
      view.cosmetics,
      view.cosmeticRoleBadges,
      cancelFollow,
    ],
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
  const moderationEvents =
    chat.kind === "live" || chat.kind === "empty"
      ? chat.moderationEvents
      : undefined;
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
      const unseenEvents = moderationEvents?.filter(
        ({ revision }) =>
          revision > appliedSource.moderationRevision &&
          revision <= moderationRevision,
      );
      const completeEvents =
        !moderated ||
        (unseenEvents?.length ===
          moderationRevision - appliedSource.moderationRevision &&
          unseenEvents[0]?.revision === appliedSource.moderationRevision + 1);
      const current = new Map(messages.map((message) => [message.id, message]));
      const reconcile = (held: readonly WatchChatMessage[]) =>
        held.flatMap((message) => {
          const updated = current.get(message.id);
          if (updated) return [updated];
          if (!moderated) return [message];
          if (!completeEvents) return [];
          return (
            unseenEvents?.reduce<readonly WatchChatMessage[]>(
              (rows, { event }) => applyWatchChatModeration(rows, event),
              [message],
            ) ?? []
          );
        });
      setPausedMessages((held) => (held ? reconcile(held) : null));
      setPickerMessages(reconcile);
      const reconcileSelection = (held: WatchChatMessage | null) => {
        if (!held) return null;
        const [updated] = reconcile([held]);
        return updated && updated.deletedAt === undefined ? updated : null;
      };
      setSelected(reconcileSelection);
      setReply(reconcileSelection);
    }
  }
  const handleScroll = useCallback(
    (event: {
      readonly nativeEvent: { readonly contentOffset: { readonly y: number } };
    }) => {
      const offset = event.nativeEvent.contentOffset.y;
      if (readingGesture.current === "none" || overlayRef.current) return;
      if (offset > 24) {
        cancelFollow();
        followingRef.current = false;
        setPausedMessages((previous) => previous ?? gestureMessages.current);
      } else if (readingGesture.current !== "coast") {
        followingRef.current = true;
        setPausedMessages(null);
      }
    },
    [cancelFollow],
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
      <View style={styles.messageViewport}>
        <FlatList
          ref={list}
          onViewableItemsChanged={onVisibleMessages}
          onScroll={handleScroll}
          onScrollBeginDrag={() => {
            cancelFollow();
            gestureMessages.current = visibleMessages;
            readingGesture.current = "drag";
            followingRef.current = false;
            setPausedMessages(
              (previous) => previous ?? gestureMessages.current,
            );
          }}
          onScrollEndDrag={() => {
            readingGesture.current = "coast";
          }}
          onMomentumScrollBegin={() => {
            if (
              readingGesture.current !== "coast" &&
              readingGesture.current !== "drag"
            )
              return;
            readingGesture.current = "momentum";
          }}
          onMomentumScrollEnd={(event) => {
            if (
              readingGesture.current === "momentum" &&
              event.nativeEvent.contentOffset.y <= 24 &&
              !overlayRef.current
            ) {
              followingRef.current = true;
              setPausedMessages(null);
            }
            readingGesture.current = "none";
            requestFollow();
          }}
          onContentSizeChange={requestFollow}
          onLayout={requestFollow}
          scrollEventThrottle={64}
          style={styles.messages}
          contentContainerStyle={styles.messageList}
          testID={`${testID}-scroll`}
          inverted
          maintainVisibleContentPosition={
            following && !picker && selected === null
              ? undefined
              : VISIBLE_POSITION_ANCHOR
          }
          data={newestFirst}
          keyExtractor={(message) => message.id}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={3}
          renderItem={renderMessage}
        />
        {pausedMessages ? (
          <Pressable
            accessibilityLabel="Resume live chat"
            accessibilityRole="button"
            testID="chat-resume"
            onPress={() => {
              readingGesture.current = "none";
              followingRef.current = true;
              setPausedMessages(null);
            }}
            style={styles.resume}
          >
            <ArrowDown color={mobileColors.textPrimary} size={16} />
            <Text style={[mobileType.label, styles.resumeText]}>
              {t("chat.chatPausedDueToScroll", {
                defaultValue: "Chat paused due to scroll",
              })}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {selected ? (
        <ChatUserSheet
          selected={selected}
          messages={messages}
          platform={platform}
          {...(presentation ? { presentation } : {})}
          canCompose={!recorded && !readOnly && view.access === "ready"}
          canReply={!recorded && !readOnly && view.access === "ready"}
          emotes={emotes}
          preferences={preferences}
          {...(view.cosmetics ? { cosmetics: view.cosmetics } : {})}
          {...(view.cosmeticRoleBadges
            ? { roleBadges: view.cosmeticRoleBadges }
            : {})}
          onSelect={setSelected}
          onDismiss={() => setSelected(null)}
          onReply={() => {
            setReply(selected);
            setSelected(null);
            requestAnimationFrame(() => input.current?.focus());
          }}
          onCopyToChat={() => {
            if (selected.deletedAt !== undefined) return;
            setDraft((value) => `${value}${value ? " " : ""}${selected.text}`);
            setSelected(null);
            requestAnimationFrame(() => input.current?.focus());
          }}
          onMention={() => {
            if (!selected.username) return;
            setDraft(
              (value) => `${value}${value ? " " : ""}@${selected.username} `,
            );
            setSelected(null);
            requestAnimationFrame(() => input.current?.focus());
          }}
          {...(interactions && !readOnly
            ? {
                onBlock: () => {
                  void interactions.userAction(selected, "block");
                  setSelected(null);
                },
              }
            : {})}
          {...(interactions
            ? {
                onReport: () => {
                  void interactions.userAction(selected, "report");
                  setSelected(null);
                },
              }
            : {})}
          {...(onModerateMessage && !readOnly
            ? {
                onModerate: () => {
                  onModerateMessage(selected);
                  setSelected(null);
                },
              }
            : {})}
        />
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
          {quickEmotes.length ? (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="always"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickEmotes}
              testID="chat-quick-emotes"
            >
              {quickEmotes.map((emote) => (
                <Pressable
                  key={`${emote.provider}:${emote.id}`}
                  accessibilityLabel={`Send ${emote.name}`}
                  accessibilityRole="button"
                  accessibilityState={{
                    disabled: view.access !== "ready" || view.sending,
                  }}
                  disabled={view.access !== "ready" || view.sending}
                  onPress={() => {
                    void sendQuickEmote(emote);
                  }}
                  style={styles.quickEmoteChoice}
                  testID="chat-quick-emote"
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
                </Pressable>
              ))}
            </ScrollView>
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
                        interactions?.rememberEmote(emote);
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
          <View style={styles.actions}>
            <MobileIconButton
              label={picker ? "Close emotes" : "Open emotes"}
              selected={picker}
              onPress={() => {
                setPickerMessages(messages);
                setPicker((value) => !value);
              }}
              testID="chat-emotes"
            >
              <Smile color={mobileColors.textSecondary} size={24} />
            </MobileIconButton>
            <TextInput
              ref={input}
              accessibilityLabel="Chat message"
              editable={view.access === "ready" && !view.sending}
              multiline
              maxLength={1000}
              placeholder={
                view.access === "ready" ? "Send a message..." : "Read-only chat"
              }
              placeholderTextColor={mobileColors.textSecondary}
              value={draft}
              onChangeText={setDraft}
              style={styles.input}
              testID="chat-draft"
            />
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
  messageViewport: { flex: 1, minHeight: 0, position: "relative" },
  messages: { flex: 1, minHeight: 0 },
  resume: {
    position: "absolute",
    bottom: mobileSpacing.small,
    alignSelf: "center",
    maxWidth: "100%",
    flexDirection: "row",
    gap: mobileSpacing.small,
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderRadius: mobileRadii.full,
  },
  resumeText: { color: mobileColors.textPrimary, flexShrink: 1 },
  messageList: {
    gap: mobileSpacing.xSmall,
    paddingBottom: mobileSpacing.small,
  },
  emote: { width: 28, height: 28 },
  quickEmotes: { flexDirection: "row", gap: mobileSpacing.xSmall },
  quickEmoteChoice: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.medium,
  },
  composer: { gap: mobileSpacing.xSmall, paddingBottom: mobileSpacing.small },
  input: {
    ...mobileType.body,
    color: mobileColors.textPrimary,
    minHeight: 48,
    flex: 1,
    minWidth: 0,
    maxHeight: 100,
    padding: mobileSpacing.small,
    backgroundColor: mobileColors.surface,
    borderWidth: 1,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
  },
  actions: {
    flexDirection: "row",
    alignItems: "flex-end",
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
