import type React from "react";
import { memo, useCallback, useEffect, useEffectEvent, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useManagedTimeout } from "../../hooks/useManagedTimeout";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../shared/auth-types";
import type { ChatMessage as ChatMessageType } from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { useChatStore } from "../../store/chat-store";
import { useRenderCount } from "../dev/use-render-count";
import { ChatMessage } from "./ChatMessage";
import type { UsernameChannelContext } from "./Username";

// Pause only on confirmed user intent: a wheel-up event (deltaY < 0) followed
// by atBottomStateChange(false), debounced 200ms. Layout shifts from rapid
// messages, emote loads, and resizes never set userScrolledUpRef, so they
// are ignored. Mirrors Xtra's SCROLL_STATE_DRAGGING gate, adapted for web.

const MemoizedChatMessage = memo(ChatMessage);
const EMPTY_MESSAGES: ChatMessageType[] = [];
const CHAT_LIST_OVERSCAN_PX = 150;
const CHAT_LIST_INCREASE_VIEWPORT_BY = { top: 240, bottom: 480 };

function estimateDefaultItemHeight(chatDisplay: typeof DEFAULT_CHAT_DISPLAY_PREFERENCES): number {
  const lineHeight = chatDisplay.density === "compact" ? 1.2 : 1.35;
  const verticalPadding = chatDisplay.density === "compact" ? 0 : 4;
  return Math.ceil(
    Math.max(chatDisplay.emoteSizePx, chatDisplay.fontSizePx * lineHeight) + verticalPadding
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
  onBan?: (message: ChatMessageType) => void;
  onUnban?: (message: ChatMessageType) => void;
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
    onBan,
    onUnban,
    onDelete,
    selfUserId,
    currentChannelContext,
  }) => {
    useRenderCount(`ChatMessageList:${channelKey}`);
    const messages = useChatStore((state) => state.messagesByChannel[channelKey] ?? EMPTY_MESSAGES);
    const isPaused = useChatStore((state) => state.pausedChannels.has(channelKey));
    const setPaused = useChatStore((state) => state.setPaused);
    const chatDisplay =
      useAuthStore((state) => state.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
    const pauseMode = chatDisplay.pauseMode ?? DEFAULT_CHAT_DISPLAY_PREFERENCES.pauseMode;
    const pauseOnMouseover = pauseMode === "mouseover" || pauseMode === "mouseover-alt";
    const pauseOnAlt = pauseMode === "alt" || pauseMode === "mouseover-alt";
    const defaultItemHeight = estimateDefaultItemHeight(chatDisplay);

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const userScrolledUpRef = useRef(false);
    const pendingPauseRef = useRef(false);
    const mouseoverPauseRef = useRef(false);
    const altPauseRef = useRef(false);
    const pauseTimer = useManagedTimeout(
      useCallback(() => setPaused(channelKey, true), [channelKey, setPaused])
    );

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
    const hasTimeout = Boolean(onTimeout);
    const hasBan = Boolean(onBan);
    const hasUnban = Boolean(onUnban);
    const hasDelete = Boolean(onDelete);

    // Count of messages added while paused — shown in the banner's hover state.
    // Length-delta is approximate when the store trims, but display caps at "20+".
    const pausedBaselineLengthRef = useRef(messages.length);
    const previousMessageLengthRef = useRef(messages.length);
    const wasPausedRef = useRef(isPaused);
    const initialTopMostItemIndexRef = useRef(messages.length > 0 ? messages.length - 1 : 0);

    if (!isPaused) {
      pausedBaselineLengthRef.current = messages.length;
    } else if (!wasPausedRef.current) {
      pausedBaselineLengthRef.current = previousMessageLengthRef.current;
    }
    const pausedCount = isPaused
      ? Math.max(0, messages.length - pausedBaselineLengthRef.current)
      : 0;
    wasPausedRef.current = isPaused;
    previousMessageLengthRef.current = messages.length;

    useEffect(() => {
      userScrolledUpRef.current = false;
      pendingPauseRef.current = false;
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

    const onWheelScroll = useCallback((e: Event) => {
      if ((e as WheelEvent).deltaY < 0) {
        userScrolledUpRef.current = true;
      }
    }, []);

    const onMouseEnterChat = useCallback(() => {
      if (!pauseOnMouseover) return;
      mouseoverPauseRef.current = true;
      setPaused(channelKey, true);
    }, [channelKey, pauseOnMouseover, setPaused]);

    const onMouseLeaveChat = useCallback(() => {
      mouseoverPauseRef.current = false;
      resumeIfNoPauseTrigger();
    }, [resumeIfNoPauseTrigger]);

    const scrollerCallbackRef = useCallback(
      (el: HTMLElement | Window | null) => {
        if (scrollerRef.current instanceof HTMLElement) {
          scrollerRef.current.removeEventListener("wheel", onWheelScroll);
          scrollerRef.current.removeEventListener("mouseenter", onMouseEnterChat);
          scrollerRef.current.removeEventListener("mouseleave", onMouseLeaveChat);
        }
        if (el instanceof HTMLElement) {
          scrollerRef.current = el;
          el.addEventListener("wheel", onWheelScroll, { passive: true });
          el.addEventListener("mouseenter", onMouseEnterChat);
          el.addEventListener("mouseleave", onMouseLeaveChat);
        } else {
          scrollerRef.current = null;
        }
      },
      [onMouseEnterChat, onMouseLeaveChat, onWheelScroll]
    );

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

    const itemContent = useCallback(
      (_index: number, message: ChatMessageType) => (
        <MemoizedChatMessage
          key={message.id}
          message={message}
          onReply={handleReply}
          onPin={hasPin ? handlePin : undefined}
          onTimeout={hasTimeout ? handleTimeout : undefined}
          onBan={hasBan ? handleBan : undefined}
          onUnban={hasUnban ? handleUnban : undefined}
          onDelete={hasDelete ? handleDelete : undefined}
          selfUserId={selfUserId}
          currentChannelContext={currentChannelContext}
        />
      ),
      [
        handleReply,
        handlePin,
        hasPin,
        handleTimeout,
        hasTimeout,
        handleBan,
        hasBan,
        handleUnban,
        hasUnban,
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
      userScrolledUpRef.current = false;
      pendingPauseRef.current = false;
      setPaused(channelKey, false);
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: "auto",
      });
    }, [channelKey, setPaused]);

    const followOutput = useCallback(
      (_isAtBottom: boolean) => {
        if (isPaused || pendingPauseRef.current) return false;
        return "auto";
      },
      [isPaused]
    );

    return (
      <div className="relative flex-1 h-full min-h-0 min-w-0 overflow-x-hidden">
        <Virtuoso
          ref={virtuosoRef}
          data={messages}
          itemContent={itemContent}
          computeItemKey={computeItemKey}
          followOutput={followOutput}
          initialTopMostItemIndex={initialTopMostItemIndexRef.current}
          atBottomThreshold={20}
          overscan={CHAT_LIST_OVERSCAN_PX}
          increaseViewportBy={CHAT_LIST_INCREASE_VIEWPORT_BY}
          atBottomStateChange={handleAtBottomStateChange}
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
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 rounded-full bg-black/60 border border-white/20">
            <button
              type="button"
              onClick={scrollToBottom}
              className="group inline-flex items-center justify-center gap-[5px] px-[18px] py-1.5 rounded-full text-white text-xs font-semibold whitespace-nowrap transition-colors hover:bg-white/[0.13]"
            >
              <span className="inline-flex items-center gap-[5px] group-hover:hidden">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M10 4H5v16h5V4Zm9 0h-5v16h5V4Z" />
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
                <span>
                  {pausedCount >= 20 ? "20+ new messages" : `${pausedCount} new messages`}
                </span>
              </span>
            </button>
          </div>
        )}
      </div>
    );
  }
);

ChatMessageList.displayName = "ChatMessageList";
