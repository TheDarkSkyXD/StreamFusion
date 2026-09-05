import { useTranslation } from "react-i18next";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { useRenderCount } from "@/components/dev/use-render-count";
import { useChatStore } from "@/store/chat-store";

import type { MergedChatMessage, MultiChatChannel } from "../../data/multi-chat-feed";
import { mergeChatMessageBuckets } from "../../data/multi-chat-feed";
import { ChatMessage } from "./ChatMessage";

const PLATFORM_ACCENT = {
  twitch: "#a970ff",
  kick: "#53fc18",
} as const;

interface MergedChatFeedProps {
  channels: readonly MultiChatChannel[];
  onSelectChannel: (channelKey: string) => void;
}

export const MergedChatFeed = memo(function MergedChatFeed({
  channels,
  onSelectChannel,
}: MergedChatFeedProps) {
  const { t } = useTranslation();
  useRenderCount("MergedChatFeed");
  const messagesByChannel = useChatStore((state) => state.messagesByChannel);
  const messages = useMemo(
    () => mergeChatMessageBuckets(channels, messagesByChannel),
    [channels, messagesByChannel]
  );
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const computeItemKey = useCallback((_index: number, entry: MergedChatMessage) => entry.key, []);
  const itemContent = useCallback(
    (_index: number, entry: MergedChatMessage) => (
      <div className="border-b border-[color:var(--color-border)]/55 pb-1">
        <button
          type="button"
          onClick={() => onSelectChannel(entry.channelKey)}
          className="mx-2 mt-1 inline-flex h-5 max-w-[calc(100%-1rem)] items-center gap-1.5 rounded px-1.5 text-[11px] font-semibold text-[var(--color-foreground-muted)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          aria-label={t("chat.openValue0Chat", { value0: entry.channelLabel })}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: PLATFORM_ACCENT[entry.message.platform] }}
            aria-hidden="true"
          />
          <span className="truncate">{entry.channelLabel}</span>
        </button>
        <ChatMessage message={entry.message} embedded />
      </div>
    ),
    [onSelectChannel, t]
  );
  const scrollToBottom = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
  }, []);

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-5 text-center text-sm text-[var(--color-foreground-muted)]">
        {t("chat.messagesFromEveryOpenStreamWillAppearHere")}
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 min-w-0 overflow-x-hidden">
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        itemContent={itemContent}
        computeItemKey={computeItemKey}
        initialTopMostItemIndex={messages.length - 1}
        followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
        atBottomStateChange={setIsAtBottom}
        atBottomThreshold={20}
        overscan={80}
        increaseViewportBy={{ top: 120, bottom: 240 }}
        className="chat-scrollbar"
        style={{ height: "100%", width: "100%", overflowX: "hidden" }}
      />

      {!isAtBottom && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-[60] flex max-w-full justify-center">
          <button
            type="button"
            onClick={scrollToBottom}
            aria-label={t("chat.chatPausedDueToScroll")}
            className="pointer-events-auto inline-flex max-w-full min-w-0 items-center justify-center gap-[5px] rounded-full border border-white/20 bg-[#2d2d2d] px-[18px] py-1.5 text-xs font-semibold whitespace-nowrap text-white shadow-lg transition-colors hover:bg-[#2d2d2d]/90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#2d2d2d] focus-visible:outline-none motion-reduce:transition-none"
          >
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
            <span>{t("chat.chatPausedDueToScroll")}</span>
          </button>
        </div>
      )}
    </div>
  );
});
