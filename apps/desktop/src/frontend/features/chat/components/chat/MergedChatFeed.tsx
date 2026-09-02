import { i18n } from "@/i18n";
import { memo, useCallback, useMemo } from "react";
import { Virtuoso } from "react-virtuoso";

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
  useRenderCount("MergedChatFeed");
  const messagesByChannel = useChatStore((state) => state.messagesByChannel);
  const messages = useMemo(
    () => mergeChatMessageBuckets(channels, messagesByChannel),
    [channels, messagesByChannel]
  );
  const computeItemKey = useCallback((_index: number, entry: MergedChatMessage) => entry.key, []);
  const itemContent = useCallback(
    (_index: number, entry: MergedChatMessage) => (
      <div className="border-b border-[color:var(--color-border)]/55 pb-1">
        <button
          type="button"
          onClick={() => onSelectChannel(entry.channelKey)}
          className="mx-2 mt-1 inline-flex h-5 max-w-[calc(100%-1rem)] items-center gap-1.5 rounded px-1.5 text-[11px] font-semibold text-[var(--color-foreground-muted)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          aria-label={i18n.t("chat.openValue0Chat", { value0: entry.channelLabel })}
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
    [onSelectChannel]
  );

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-5 text-center text-sm text-[var(--color-foreground-muted)]">
        {i18n.t("chat.messagesFromEveryOpenStreamWillAppearHere")}
      </div>
    );
  }

  return (
    <Virtuoso
      data={messages}
      itemContent={itemContent}
      computeItemKey={computeItemKey}
      initialTopMostItemIndex={messages.length - 1}
      followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
      atBottomThreshold={20}
      overscan={80}
      increaseViewportBy={{ top: 120, bottom: 240 }}
      className="chat-scrollbar"
      style={{ height: "100%", width: "100%", overflowX: "hidden" }}
    />
  );
});
