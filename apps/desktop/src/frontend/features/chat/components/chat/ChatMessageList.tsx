import type React from "react";
import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useManagedTimeout } from "../../../../hooks/useManagedTimeout";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../../../../shared/auth-types";
import type {
  ChatMessage as ChatMessageType,
  ChatPlatform,
} from "../../../../../shared/chat-types";
import { useChatStore } from "../../../../store/chat-store";
import { useRenderCount } from "../../../../components/dev/use-render-count";
import { useChatDisplay } from "../../../settings/data/use-chat-display";
import { ChatMessage } from "./ChatMessage";
import type { UsernameChannelContext } from "./Username";

// Pause only on confirmed user intent: an upward wheel, scrollbar gesture, or
// upward navigation key while meaningfully away from bottom. Virtualizer repair,
// row measurement, emote loading, and resizing can also move scrollTop, so raw
// scroll direction alone is not user intent.

const MemoizedChatMessage = memo(ChatMessage);
const EMPTY_MESSAGES: ChatMessageType[] = [];
const CHAT_LIST_OVERSCAN_PX = 80;
const CHAT_LIST_INCREASE_VIEWPORT_BY = { top: 120, bottom: 240 };
const CHAT_AT_BOTTOM_THRESHOLD_PX = 20;
const BOTTOM_FOLLOW_RESIDUAL_GAP_PX = 4;
const VIRTUOSO_FIRST_ITEM_INDEX_BASE = 1_000_000;
const CHAT_INITIAL_LOCATION = { index: "LAST", align: "end" } as const;
const NEW_MESSAGES_DIVIDER_COLOR: Record<ChatPlatform, string> = {
  twitch: "#a970ff",
  kick: "#53fc18",
};

interface ChatScrollerListeners {
  clearKeyboardScrollIntent: EventListener;
  clearPointerScrollIntent: EventListener;
  onMouseEnterChat: EventListener;
  onMouseLeaveChat: EventListener;
  onPointerDown: EventListener;
  onScrollerKeyDown: EventListener;
  onScrollerScroll: EventListener;
  onWheelScroll: EventListener;
}

function addChatScrollerListeners(scroller: HTMLElement, listeners: ChatScrollerListeners): void {
  scroller.addEventListener("wheel", listeners.onWheelScroll, { passive: true });
  scroller.addEventListener("pointerdown", listeners.onPointerDown, { passive: true });
  scroller.addEventListener("pointerup", listeners.clearPointerScrollIntent, { passive: true });
  scroller.addEventListener("pointercancel", listeners.clearPointerScrollIntent, { passive: true });
  scroller.addEventListener("keydown", listeners.onScrollerKeyDown);
  scroller.addEventListener("keyup", listeners.clearKeyboardScrollIntent);
  scroller.addEventListener("scroll", listeners.onScrollerScroll, { passive: true });
  scroller.addEventListener("mouseenter", listeners.onMouseEnterChat);
  scroller.addEventListener("mouseleave", listeners.onMouseLeaveChat);
}

function removeChatScrollerListeners(
  scroller: HTMLElement,
  listeners: ChatScrollerListeners
): void {
  scroller.removeEventListener("wheel", listeners.onWheelScroll);
  scroller.removeEventListener("pointerdown", listeners.onPointerDown);
  scroller.removeEventListener("pointerup", listeners.clearPointerScrollIntent);
  scroller.removeEventListener("pointercancel", listeners.clearPointerScrollIntent);
  scroller.removeEventListener("keydown", listeners.onScrollerKeyDown);
  scroller.removeEventListener("keyup", listeners.clearKeyboardScrollIntent);
  scroller.removeEventListener("scroll", listeners.onScrollerScroll);
  scroller.removeEventListener("mouseenter", listeners.onMouseEnterChat);
  scroller.removeEventListener("mouseleave", listeners.onMouseLeaveChat);
}

function estimateDefaultItemHeight(chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES): number {
  const lineHeight = chatDisplay.density === "compact" ? chatDisplay.fontSizePx * 1.2 : 22;
  const verticalPadding =
    chatDisplay.density === "compact" ? 0 : chatDisplay.density === "loose" ? 24 : 8;
  return Math.ceil(Math.max(chatDisplay.emoteSizePx, lineHeight) + verticalPadding);
}

function advanceFirstItemIndex(
  previousMessages: ChatMessageType[],
  messages: ChatMessageType[],
  currentFirstItemIndex: number
): number {
  if (previousMessages.length === 0 || messages.length === 0) return currentFirstItemIndex;
  if (previousMessages[0].id === messages[0].id) return currentFirstItemIndex;

  const prependedCount = messages.findIndex((message) => message.id === previousMessages[0].id);
  if (prependedCount > 0) return currentFirstItemIndex - prependedCount;

  const removedCount = previousMessages.findIndex((message) => message.id === messages[0].id);
  if (removedCount > 0) return currentFirstItemIndex + removedCount;

  return currentFirstItemIndex;
}

function NewMessagesDivider({ platform }: { platform: ChatPlatform }) {
  const dividerColor = NEW_MESSAGES_DIVIDER_COLOR[platform];

  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5"
      aria-label="New messages"
      style={{ color: dividerColor }}
    >
      <div className="h-px min-w-0 flex-1 bg-current" />
      <div className="shrink-0 text-sm font-bold leading-none">New messages</div>
      <div className="h-px min-w-0 flex-1 bg-current" />
    </div>
  );
}

interface ChatMessageListProps {
  channelKey: string;
  onReply?: (message: ChatMessageType) => void;
  /** Optional pin action — when provided, a hover Pin button is rendered on
   *  Twitch chat messages. Latest-ref pattern below keeps itemContent stable. */
  onPin?: (message: ChatMessageType) => void;
  /** Optional mod-action callbacks. When provided, hover buttons render
   *  per-message (see ChatMessage.tsx). Same latest-ref pattern as onPin so
   *  Virtuoso's itemContent identity stays stable. */
  onTimeout?: (message: ChatMessageType) => void;
  onWarn?: (message: ChatMessageType) => void;
  onBan?: (message: ChatMessageType) => void;
  onUnban?: (message: ChatMessageType) => void;
  unbanUserIds?: ReadonlySet<string>;
  onDelete?: (message: ChatMessageType) => void;
  /** Signed-in user's platform user id; used to hide self-mod buttons. */
  selfUserId?: string;
  /** U18 — forwarded to each message's Username so username clicks open
   *  the user popout scoped to this channel. */
  currentChannelContext?: UsernameChannelContext;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = memo(
  ({
    channelKey,
    onReply,
    onPin,
    onTimeout,
    onWarn,
    onBan,
    onUnban,
    unbanUserIds,
    onDelete,
    selfUserId,
    currentChannelContext,
  }) => {
    useRenderCount(`ChatMessageList:${channelKey}`);
    const messages = useChatStore((state) => state.messagesByChannel[channelKey] ?? EMPTY_MESSAGES);
    const isPaused = useChatStore((state) => state.pausedChannels.has(channelKey));
    const setPaused = useChatStore((state) => state.setPaused);
    const trimChannelToMessageLimit = useChatStore((state) => state.trimChannelToMessageLimit);
    const { cd: chatDisplay } = useChatDisplay();
    const pauseMode = chatDisplay.pauseMode ?? DEFAULT_CHAT_DISPLAY_PREFERENCES.pauseMode;
    const pauseOnMouseover = pauseMode === "mouseover" || pauseMode === "mouseover-alt";
    const pauseOnAlt = pauseMode === "alt" || pauseMode === "mouseover-alt";
    const defaultItemHeight = estimateDefaultItemHeight(chatDisplay);
    const virtualIndexStateRef = useRef({
      messages,
      firstItemIndex: VIRTUOSO_FIRST_ITEM_INDEX_BASE,
    });
    const virtualIndexState = virtualIndexStateRef.current;
    const firstItemIndex = advanceFirstItemIndex(
      virtualIndexState.messages,
      messages,
      virtualIndexState.firstItemIndex
    );
    useLayoutEffect(() => {
      virtualIndexStateRef.current = { messages, firstItemIndex };
    }, [firstItemIndex, messages]);
    const newMessagesStartId = useMemo(() => {
      let sawHistoricalMessage = false;

      for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.isHistorical) {
          sawHistoricalMessage = true;
          continue;
        }
        if (sawHistoricalMessage && message.type !== "system") return message.id;
      }

      return undefined;
    }, [messages]);

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const bottomCommitFrameRef = useRef<number | null>(null);
    const returnToLiveFrameRef = useRef<number | null>(null);
    const previousScrollerScrollTopRef = useRef(0);
    const pointerScrollIntentRef = useRef(false);
    const keyboardScrollIntentRef = useRef(false);
    const userScrolledUpRef = useRef(false);
    const pendingPauseRef = useRef(false);
    const returningToLiveRef = useRef(false);
    const mouseoverPauseRef = useRef(false);
    const altPauseRef = useRef(false);
    const isPausedRef = useRef(isPaused);
    const pauseTimer = useManagedTimeout(
      useCallback(() => setPaused(channelKey, true), [channelKey, setPaused])
    );

    useLayoutEffect(() => {
      isPausedRef.current = isPaused;
    }, [isPaused]);

    // Latest-ref pattern: keep `itemContent`'s identity stable across renders so
    // Virtuoso doesn't see it change (which would unmount/remount rows). A
    // future caller passing an unstable `onReply` would otherwise defeat
    // MemoizedChatMessage entirely.
    const onReplyRef = useRef(onReply);
    useEffect(() => {
      onReplyRef.current = onReply;
    }, [onReply]);
    const handleReply = useCallback((message: ChatMessageType) => {
      onReplyRef.current?.(message);
    }, []);
    // Same latest-ref pattern for onPin so itemContent's identity stays stable.
    const onPinRef = useRef(onPin);
    useEffect(() => {
      onPinRef.current = onPin;
    }, [onPin]);
    const handlePin = useCallback((message: ChatMessageType) => {
      onPinRef.current?.(message);
    }, []);
    // Mod-action callbacks — mirror the onPin latest-ref pattern. itemContent's
    // dependency array tracks only the on*-flags (truthy/falsy), not the
    // callbacks themselves, so a parent re-render that swaps the callback
    // identity doesn't unmount/remount every row.
    const onTimeoutRef = useRef(onTimeout);
    useEffect(() => {
      onTimeoutRef.current = onTimeout;
    }, [onTimeout]);
    const handleTimeout = useCallback((message: ChatMessageType) => {
      onTimeoutRef.current?.(message);
    }, []);
    const onWarnRef = useRef(onWarn);
    useEffect(() => {
      onWarnRef.current = onWarn;
    }, [onWarn]);
    const handleWarn = useCallback((message: ChatMessageType) => {
      onWarnRef.current?.(message);
    }, []);
    const onBanRef = useRef(onBan);
    useEffect(() => {
      onBanRef.current = onBan;
    }, [onBan]);
    const handleBan = useCallback((message: ChatMessageType) => {
      onBanRef.current?.(message);
    }, []);
    const onUnbanRef = useRef(onUnban);
    useEffect(() => {
      onUnbanRef.current = onUnban;
    }, [onUnban]);
    const handleUnban = useCallback((message: ChatMessageType) => {
      onUnbanRef.current?.(message);
    }, []);
    const onDeleteRef = useRef(onDelete);
    useEffect(() => {
      onDeleteRef.current = onDelete;
    }, [onDelete]);
    const handleDelete = useCallback((message: ChatMessageType) => {
      onDeleteRef.current?.(message);
    }, []);
    const hasPin = Boolean(onPin);
    const hasReply = Boolean(onReply);
    const hasTimeout = Boolean(onTimeout);
    const hasWarn = Boolean(onWarn);
    const hasBan = Boolean(onBan);
    const hasUnban = Boolean(onUnban);
    const hasDelete = Boolean(onDelete);

    // Count of messages added while paused — shown in the banner's hover state.
    // Length-delta is approximate when the store trims, but display caps at "20+".
    const pausedBaselineLengthRef = useRef(messages.length);
    const previousMessageLengthRef = useRef(messages.length);
    const wasPausedRef = useRef(isPaused);

    const pausedBaselineLength = !isPaused
      ? messages.length
      : !wasPausedRef.current
        ? previousMessageLengthRef.current
        : pausedBaselineLengthRef.current;
    const pausedCount = isPaused ? Math.max(0, messages.length - pausedBaselineLength) : 0;
    const pausedMessageCountLabel =
      pausedCount >= 20
        ? "20+ new messages"
        : pausedCount === 1
          ? "1 new message"
          : `${pausedCount} new messages`;
    useLayoutEffect(() => {
      pausedBaselineLengthRef.current = pausedBaselineLength;
      wasPausedRef.current = isPaused;
      previousMessageLengthRef.current = messages.length;
    }, [isPaused, messages.length, pausedBaselineLength]);

    useEffect(() => {
      userScrolledUpRef.current = false;
      pendingPauseRef.current = false;
      returningToLiveRef.current = false;
      mouseoverPauseRef.current = false;
      altPauseRef.current = false;
      setPaused(channelKey, false);
    }, [channelKey, setPaused]);

    const hasActiveInputPause = useCallback(
      () => (pauseOnMouseover && mouseoverPauseRef.current) || (pauseOnAlt && altPauseRef.current),
      [pauseOnAlt, pauseOnMouseover]
    );

    const resumeIfNoPauseTrigger = useCallback(() => {
      if (userScrolledUpRef.current || pendingPauseRef.current || hasActiveInputPause()) return;
      setPaused(channelKey, false);
    }, [channelKey, hasActiveInputPause, setPaused]);
    const clearAltPause = useEffectEvent(() => {
      altPauseRef.current = false;
      resumeIfNoPauseTrigger();
    });

    const onMouseEnterChat = useCallback(() => {
      if (!pauseOnMouseover) return;
      mouseoverPauseRef.current = true;
      setPaused(channelKey, true);
    }, [channelKey, pauseOnMouseover, setPaused]);

    const onMouseLeaveChat = useCallback(() => {
      mouseoverPauseRef.current = false;
      resumeIfNoPauseTrigger();
    }, [resumeIfNoPauseTrigger]);

    useEffect(() => {
      if (!pauseOnMouseover) {
        mouseoverPauseRef.current = false;
      }
      if (!pauseOnAlt) {
        altPauseRef.current = false;
      }
      resumeIfNoPauseTrigger();
    }, [pauseOnAlt, pauseOnMouseover, resumeIfNoPauseTrigger]);

    useEffect(() => {
      if (!pauseOnAlt) return;

      function onKeyDown(event: KeyboardEvent) {
        if (event.key !== "Alt" || event.repeat) return;
        altPauseRef.current = true;
        setPaused(channelKey, true);
      }

      function onKeyUp(event: KeyboardEvent) {
        if (event.key !== "Alt") return;
        clearAltPause();
      }

      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", clearAltPause);

      return () => {
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", clearAltPause);
        altPauseRef.current = false;
      };
    }, [channelKey, pauseOnAlt, setPaused]);

    const scheduleScrollPause = useCallback(() => {
      if (pendingPauseRef.current) return;
      pendingPauseRef.current = true;
      pauseTimer.start(200);
    }, [pauseTimer]);

    const onWheelScroll = useCallback(
      (e: Event) => {
        if ((e as WheelEvent).deltaY >= 0) return;
        returningToLiveRef.current = false;
        userScrolledUpRef.current = true;

        const scroller = e.currentTarget;
        if (!(scroller instanceof HTMLElement)) return;
        const bottomGap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        if (bottomGap >= CHAT_AT_BOTTOM_THRESHOLD_PX) {
          scheduleScrollPause();
        }
      },
      [scheduleScrollPause]
    );

    const onPointerDown = useCallback((event: Event) => {
      const pointerEvent = event as PointerEvent;
      const scroller = event.currentTarget;
      if (!(scroller instanceof HTMLElement)) return;

      const scrollbarWidth = Math.max(0, scroller.offsetWidth - scroller.clientWidth);
      const scrollbarStart = scroller.getBoundingClientRect().right - scrollbarWidth;
      pointerScrollIntentRef.current =
        pointerEvent.pointerType === "touch" ||
        (scrollbarWidth > 0 && pointerEvent.clientX >= scrollbarStart);
    }, []);

    const clearPointerScrollIntent = useCallback(() => {
      pointerScrollIntentRef.current = false;
    }, []);

    const onScrollerKeyDown = useCallback((event: Event) => {
      const key = (event as KeyboardEvent).key;
      keyboardScrollIntentRef.current = key === "ArrowUp" || key === "PageUp" || key === "Home";
    }, []);

    const clearKeyboardScrollIntent = useCallback(() => {
      keyboardScrollIntentRef.current = false;
    }, []);

    const onScrollerScroll = useCallback(
      (event: Event) => {
        const scroller = event.currentTarget;
        if (!(scroller instanceof HTMLElement)) return;

        const previousScrollTop = previousScrollerScrollTopRef.current;
        const currentScrollTop = scroller.scrollTop;
        previousScrollerScrollTopRef.current = currentScrollTop;

        const bottomGap = scroller.scrollHeight - currentScrollTop - scroller.clientHeight;
        const hasExplicitScrollIntent =
          pointerScrollIntentRef.current || keyboardScrollIntentRef.current;
        if (
          hasExplicitScrollIntent &&
          currentScrollTop < previousScrollTop &&
          bottomGap >= CHAT_AT_BOTTOM_THRESHOLD_PX
        ) {
          returningToLiveRef.current = false;
          userScrolledUpRef.current = true;
          scheduleScrollPause();
        }
      },
      [scheduleScrollPause]
    );

    const scrollerCallbackRef = useCallback(
      (el: HTMLElement | Window | null) => {
        const listeners: ChatScrollerListeners = {
          clearKeyboardScrollIntent,
          clearPointerScrollIntent,
          onMouseEnterChat,
          onMouseLeaveChat,
          onPointerDown,
          onScrollerKeyDown,
          onScrollerScroll,
          onWheelScroll,
        };
        if (scrollerRef.current instanceof HTMLElement) {
          removeChatScrollerListeners(scrollerRef.current, listeners);
        }
        if (el instanceof HTMLElement) {
          scrollerRef.current = el;
          previousScrollerScrollTopRef.current = el.scrollTop;
          addChatScrollerListeners(el, listeners);
        } else {
          scrollerRef.current = null;
        }
      },
      [
        clearKeyboardScrollIntent,
        clearPointerScrollIntent,
        onMouseEnterChat,
        onMouseLeaveChat,
        onPointerDown,
        onScrollerKeyDown,
        onScrollerScroll,
        onWheelScroll,
      ]
    );

    const scrollLastItemToBottom = useCallback(() => {
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    }, []);

    const settleResidualBottomGap = useCallback((reportedListHeight?: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;

      const scrollHeight = Math.max(scroller.scrollHeight, reportedListHeight ?? 0);
      const bottomGap = scrollHeight - scroller.scrollTop - scroller.clientHeight;
      if (bottomGap > BOTTOM_FOLLOW_RESIDUAL_GAP_PX) {
        scroller.scrollTop = Math.max(0, scrollHeight - scroller.clientHeight);
      }
    }, []);

    const shouldAutoFollowBottom = useCallback(() => {
      return (
        !hasActiveInputPause() &&
        !pointerScrollIntentRef.current &&
        !keyboardScrollIntentRef.current &&
        (returningToLiveRef.current ||
          (!isPausedRef.current && !userScrolledUpRef.current && !pendingPauseRef.current))
      );
    }, [hasActiveInputPause]);

    const scheduleBottomCommit = useCallback(
      (reportedListHeight: number) => {
        if (bottomCommitFrameRef.current !== null) {
          window.cancelAnimationFrame(bottomCommitFrameRef.current);
        }

        bottomCommitFrameRef.current = window.requestAnimationFrame(() => {
          bottomCommitFrameRef.current = null;
          if (!shouldAutoFollowBottom()) return;

          settleResidualBottomGap(reportedListHeight);
        });
      },
      [settleResidualBottomGap, shouldAutoFollowBottom]
    );

    useEffect(() => {
      return () => {
        if (bottomCommitFrameRef.current !== null) {
          window.cancelAnimationFrame(bottomCommitFrameRef.current);
        }
        if (returnToLiveFrameRef.current !== null) {
          window.cancelAnimationFrame(returnToLiveFrameRef.current);
        }
      };
    }, []);

    // Height notifications are the sole passive bottom-follow authority. Letting
    // Virtuoso follow too makes it seek to its estimate before this exact commit.
    const handleTotalListHeightChanged = useCallback(
      (totalListHeight: number) => {
        if (!shouldAutoFollowBottom()) return;

        scheduleBottomCommit(totalListHeight);
      },
      [scheduleBottomCommit, shouldAutoFollowBottom]
    );

    const itemContent = useCallback(
      (_index: number, message: ChatMessageType) => (
        <>
          {message.id === newMessagesStartId && <NewMessagesDivider platform={message.platform} />}
          <MemoizedChatMessage
            key={message.id}
            message={message}
            onReply={hasReply ? handleReply : undefined}
            onPin={hasPin ? handlePin : undefined}
            onTimeout={hasTimeout ? handleTimeout : undefined}
            onWarn={hasWarn ? handleWarn : undefined}
            onBan={hasBan ? handleBan : undefined}
            onUnban={hasUnban && unbanUserIds?.has(message.userId) ? handleUnban : undefined}
            onDelete={hasDelete ? handleDelete : undefined}
            selfUserId={selfUserId}
            currentChannelContext={currentChannelContext}
          />
        </>
      ),
      [
        newMessagesStartId,
        handleReply,
        hasReply,
        handlePin,
        hasPin,
        handleTimeout,
        hasTimeout,
        handleWarn,
        hasWarn,
        handleBan,
        hasBan,
        handleUnban,
        hasUnban,
        unbanUserIds,
        handleDelete,
        hasDelete,
        selfUserId,
        currentChannelContext,
      ]
    );

    const computeItemKey = useCallback(
      (_index: number, message: ChatMessageType) => message.id,
      []
    );

    const handleAtBottomStateChange = useCallback(
      (isAtBottom: boolean) => {
        if (isAtBottom) {
          returningToLiveRef.current = false;
          userScrolledUpRef.current = false;
          pendingPauseRef.current = false;
          pauseTimer.clear();
          setPaused(channelKey, hasActiveInputPause());
        } else {
          if (!userScrolledUpRef.current) return;
          pendingPauseRef.current = true;
          pauseTimer.start(200);
        }
      },
      [channelKey, hasActiveInputPause, setPaused, pauseTimer]
    );

    const scrollToBottom = useCallback(() => {
      returningToLiveRef.current = true;
      userScrolledUpRef.current = false;
      pendingPauseRef.current = false;
      pauseTimer.clear();
      trimChannelToMessageLimit(channelKey);
      if (returnToLiveFrameRef.current !== null) {
        window.cancelAnimationFrame(returnToLiveFrameRef.current);
      }
      returnToLiveFrameRef.current = window.requestAnimationFrame(() => {
        returnToLiveFrameRef.current = null;
        scrollLastItemToBottom();
        settleResidualBottomGap();
      });
    }, [
      channelKey,
      pauseTimer,
      scrollLastItemToBottom,
      settleResidualBottomGap,
      trimChannelToMessageLimit,
    ]);

    const followOutput = useCallback(() => false, []);

    return (
      <div className="relative flex-1 h-full min-h-0 min-w-0 overflow-x-hidden">
        <Virtuoso
          ref={virtuosoRef}
          data={messages}
          itemContent={itemContent}
          computeItemKey={computeItemKey}
          firstItemIndex={firstItemIndex}
          followOutput={followOutput}
          initialTopMostItemIndex={CHAT_INITIAL_LOCATION}
          atBottomThreshold={CHAT_AT_BOTTOM_THRESHOLD_PX}
          overscan={CHAT_LIST_OVERSCAN_PX}
          increaseViewportBy={CHAT_LIST_INCREASE_VIEWPORT_BY}
          atBottomStateChange={handleAtBottomStateChange}
          totalListHeightChanged={handleTotalListHeightChanged}
          scrollerRef={scrollerCallbackRef}
          defaultItemHeight={defaultItemHeight}
          style={{
            height: "100%",
            width: "100%",
            flex: 1,
            overflowX: "hidden",
            overflowAnchor: "none",
          }}
          className="chat-scrollbar overflow-x-hidden"
        />

        {isPaused && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-[60] flex max-w-full justify-center">
            <button
              type="button"
              onClick={scrollToBottom}
              aria-label={`Scroll to live. Chat paused due to scroll, ${pausedMessageCountLabel}`}
              className="group pointer-events-auto inline-flex max-w-full min-w-0 items-center justify-center gap-[5px] rounded-full border border-white/20 bg-[#2d2d2d] px-[18px] py-1.5 text-xs font-semibold whitespace-nowrap text-white shadow-lg transition-colors hover:bg-[#2d2d2d]/90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2d2d2d] focus-visible:outline-none motion-reduce:transition-none"
            >
              <span className="inline-flex items-center gap-[5px] group-hover:hidden">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                  data-icon="arrow-down"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="m11 13.586-2.293-2.293-1.414 1.414L12 17.414l4.707-4.707-1.414-1.414L13 13.586V6h-2v7.586Z"
                  />
                </svg>
                <span>Chat paused due to scroll</span>
              </span>
              <span className="hidden items-center gap-[5px] group-hover:inline-flex">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    clipRule="evenodd"
                    d="m11 13.586-2.293-2.293-1.414 1.414L12 17.414l4.707-4.707-1.414-1.414L13 13.586V6h-2v7.586Z"
                  />
                </svg>
                <span>{pausedMessageCountLabel}</span>
              </span>
            </button>
          </div>
        )}
      </div>
    );
  }
);

ChatMessageList.displayName = "ChatMessageList";
