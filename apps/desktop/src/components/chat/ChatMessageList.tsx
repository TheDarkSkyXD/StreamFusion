import type React from "react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { ChatMessage as ChatMessageType } from "../../shared/chat-types";
import { useChatStore } from "../../store/chat-store";
import { ChatMessage } from "./ChatMessage";

/**
 * Performance-optimized ChatMessageList
 *
 * Optimizations (based on KickTalk-main analysis):
 * 1. Uses react-virtuoso instead of @tanstack/react-virtual (better defaults)
 * 2. Memoized component wrapper with React.memo
 * 3. useCallback for item rendering to prevent re-renders
 * 4. Configurable overscan and viewport buffer
 * 5. Efficient scroll handling with threshold matching KickTalk
 * 6. followOutput for automatic smooth scrolling
 * 7. alignToBottom for proper bottom-anchored chat behavior
 */

// Memoized message wrapper to prevent unnecessary re-renders
const MemoizedChatMessage = memo(ChatMessage);

export const ChatMessageList: React.FC = memo(() => {
  const messages = useChatStore((state) => state.messages);
  const isPaused = useChatStore((state) => state.isPaused);
  const setPaused = useChatStore((state) => state.setPaused);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    };
  }, []);

  // Memoized item renderer - critical for performance
  const itemContent = useCallback((_index: number, message: ChatMessageType) => {
    return <MemoizedChatMessage key={message.id} message={message} />;
  }, []);

  // Stable key computation
  const computeItemKey = useCallback((_index: number, message: ChatMessageType) => {
    return message.id;
  }, []);

  // Virtuoso's built-in atBottomStateChange handler
  const handleAtBottomStateChange = useCallback(
    (isAtBottom: boolean) => {
      setAtBottom(isAtBottom);

      if (isAtBottom) {
        // Cancel any pending pause and immediately resume
        if (pauseTimerRef.current) {
          clearTimeout(pauseTimerRef.current);
          pauseTimerRef.current = null;
        }
        setPaused(false);
      } else {
        // Debounce pause to avoid false triggers from Virtuoso layout flicker
        if (pauseTimerRef.current) return;
        pauseTimerRef.current = setTimeout(() => {
          pauseTimerRef.current = null;
          setPaused(true);
        }, 200);
      }
    },
    [setPaused]
  );

  // Scroll to bottom handler
  const scrollToBottom = useCallback(() => {
    setPaused(false);
    setAtBottom(true);
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  }, [setPaused]);

  // followOutput controls auto-scroll behavior
  // Returns 'auto' when not paused so new messages always scroll into view
  // Returns false when paused (user scrolled up)
  const followOutput = useCallback(
    (_isAtBottom: boolean) => {
      return isPaused ? false : "auto";
    },
    [isPaused]
  );

  return (
    <div className="relative flex-1 h-full min-h-0">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        itemContent={itemContent}
        computeItemKey={computeItemKey}
        // Auto-scroll configuration
        followOutput={followOutput}
        initialTopMostItemIndex={0}
        // Performance tuning
        // Low threshold for instant pause when scrolling up
        atBottomThreshold={20}
        overscan={50} // Increased from 10 - renders more items outside viewport
        increaseViewportBy={400} // Buffer around viewport
        defaultItemHeight={32} // Estimated row height
        // State handlers
        atBottomStateChange={handleAtBottomStateChange}
        // Styling
        style={{
          height: "100%",
          width: "100%",
          flex: 1,
        }}
        className="no-scrollbar"
      />

      {/* Scroll to Bottom Button - only show when NOT at bottom */}
      {!atBottom && (
        <div
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded text-xs font-bold border border-white/20 hover:bg-black transition-colors z-10 shadow-lg cursor-pointer flex items-center gap-2"
        >
          <span>Scroll To Bottom</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path d="M11.9999 13.1714L16.9497 8.22168L18.3639 9.63589L11.9999 15.9999L5.63599 9.63589L7.0502 8.22168L11.9999 13.1714Z" />
          </svg>
        </div>
      )}
    </div>
  );
});

ChatMessageList.displayName = "ChatMessageList";
