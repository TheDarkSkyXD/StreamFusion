import type React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { ChatMessage as ChatMessageType } from "../../shared/chat-types";
import { useChatStore } from "../../store/chat-store";
import { useRenderCount } from "../dev/use-render-count";
import { ChatMessage } from "./ChatMessage";

// Pause only on confirmed user intent: a wheel-up event (deltaY < 0) followed
// by atBottomStateChange(false), debounced 200ms. Layout shifts from rapid
// messages, emote loads, and resizes never set userScrolledUpRef, so they
// are ignored. Mirrors Xtra's SCROLL_STATE_DRAGGING gate, adapted for web.

const MemoizedChatMessage = memo(ChatMessage);

interface ChatMessageListProps {
  onReply?: (message: ChatMessageType) => void;
  /** Optional pin action — when provided, a hover Pin button is rendered on
   *  Twitch chat messages. Latest-ref pattern below keeps itemContent stable. */
  onPin?: (message: ChatMessageType) => void;
}

export const ChatMessageList: React.FC<ChatMessageListProps> = memo(({ onReply, onPin }) => {
  useRenderCount("ChatMessageList");
  const messages = useChatStore((state) => state.messages);
  const isPaused = useChatStore((state) => state.isPaused);
  const setPaused = useChatStore((state) => state.setPaused);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userScrolledUpRef = useRef(false);
  const pendingPauseRef = useRef(false);

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

  // Count of messages added while paused — shown in the banner's hover state.
  // Length-delta is approximate when the store trims, but display caps at "20+".
  const [pausedCount, setPausedCount] = useState(0);
  const lastSeenLengthRef = useRef(messages.length);

  useEffect(() => {
    if (!isPaused) {
      setPausedCount(0);
      lastSeenLengthRef.current = messages.length;
      return;
    }
    const delta = messages.length - lastSeenLengthRef.current;
    if (delta > 0) setPausedCount((c) => c + delta);
    lastSeenLengthRef.current = messages.length;
  }, [messages.length, isPaused]);

  useEffect(() => {
    if (pauseTimerRef.current) {
      clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = null;
    }
    userScrolledUpRef.current = false;
    pendingPauseRef.current = false;
    setPaused(false);
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, [setPaused]);

  const onWheelScroll = useCallback((e: Event) => {
    if ((e as WheelEvent).deltaY < 0) {
      userScrolledUpRef.current = true;
    }
  }, []);

  const scrollerCallbackRef = useCallback(
    (el: HTMLElement | Window | null) => {
      if (scrollerRef.current instanceof HTMLElement) {
        scrollerRef.current.removeEventListener("wheel", onWheelScroll);
      }
      if (el instanceof HTMLElement) {
        scrollerRef.current = el;
        el.addEventListener("wheel", onWheelScroll, { passive: true });
      } else {
        scrollerRef.current = null;
      }
    },
    [onWheelScroll],
  );

  const itemContent = useCallback(
    (_index: number, message: ChatMessageType) => (
      <MemoizedChatMessage
        key={message.id}
        message={message}
        onReply={handleReply}
        onPin={onPin ? handlePin : undefined}
      />
    ),
    [handleReply, handlePin, onPin],
  );

  const computeItemKey = useCallback(
    (_index: number, message: ChatMessageType) => message.id,
    [],
  );

  const handleAtBottomStateChange = useCallback(
    (isAtBottom: boolean) => {
      if (isAtBottom) {
        userScrolledUpRef.current = false;
        pendingPauseRef.current = false;
        if (pauseTimerRef.current) {
          clearTimeout(pauseTimerRef.current);
          pauseTimerRef.current = null;
        }
        setPaused(false);
      } else {
        if (!userScrolledUpRef.current) return;
        pendingPauseRef.current = true;
        if (pauseTimerRef.current) return;
        pauseTimerRef.current = setTimeout(() => {
          pauseTimerRef.current = null;
          setPaused(true);
        }, 200);
      }
    },
    [setPaused],
  );

  const scrollToBottom = useCallback(() => {
    userScrolledUpRef.current = false;
    pendingPauseRef.current = false;
    setPaused(false);
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  }, [setPaused]);

  const followOutput = useCallback(
    (_isAtBottom: boolean) => {
      if (isPaused || pendingPauseRef.current) return false;
      return "auto";
    },
    [isPaused],
  );

  return (
    <div className="relative flex-1 h-full min-h-0">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        itemContent={itemContent}
        computeItemKey={computeItemKey}
        followOutput={followOutput}
        initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
        atBottomThreshold={20}
        overscan={50}
        increaseViewportBy={400}
        defaultItemHeight={32}
        atBottomStateChange={handleAtBottomStateChange}
        scrollerRef={scrollerCallbackRef}
        style={{ height: "100%", width: "100%", flex: 1 }}
        className="no-scrollbar"
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
              <span>{pausedCount >= 20 ? "20+ new messages" : `${pausedCount} new messages`}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
});

ChatMessageList.displayName = "ChatMessageList";
