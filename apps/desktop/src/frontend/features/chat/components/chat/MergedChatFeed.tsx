import { useTranslation } from "react-i18next";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ArrowDown, MessagesSquare } from "lucide-react";

import { useRenderCount } from "@/components/dev/use-render-count";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { useChatStore } from "@/features/chat/components/state/chat-store";

import type { MergedChatMessage, MultiChatChannel } from "../state/multi-chat-feed";
import { mergeChatMessageBuckets } from "../state/multi-chat-feed";
import { ChatMessage } from "./ChatMessage";

const PLATFORM_ICON = {
  twitch: TwitchIcon,
  kick: KickIcon,
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
    (_index: number, entry: MergedChatMessage) => {
      const PlatformIcon = PLATFORM_ICON[entry.message.platform];

      return (
        <div className="mx-1 rounded-md py-1 transition-colors hover:bg-[var(--color-background-tertiary)] motion-reduce:transition-none">
          <button
            type="button"
            onClick={() => onSelectChannel(entry.channelKey)}
            className="mx-1 inline-flex h-5 max-w-[calc(100%-0.5rem)] items-center gap-1.5 rounded px-1.5 text-xs font-semibold tracking-[0.025em] text-[var(--color-foreground-muted)] transition-colors hover:bg-[var(--color-background-secondary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] motion-reduce:transition-none"
            aria-label={t("chat.openValue0Chat", { value0: entry.channelLabel })}
          >
            <span className="shrink-0" aria-hidden="true">
              <PlatformIcon
                size={12}
                className={
                  entry.message.platform === "twitch" ? "text-[#a970ff]" : "text-[#53fc18]"
                }
              />
            </span>
            <span className="truncate">{entry.channelLabel}</span>
          </button>
          <ChatMessage message={entry.message} embedded />
        </div>
      );
    },
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
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-8 text-center text-sm text-[var(--color-foreground-muted)]">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-background-tertiary)] text-[var(--color-foreground-secondary)]">
          <MessagesSquare className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="max-w-56 leading-5">{t("chat.messagesFromEveryOpenStreamWillAppearHere")}</p>
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
            aria-label={t("chat.scrollToLiveChatPausedDueToScrollValue0", {
              value0: t("chat.newMessages"),
            })}
            className="pointer-events-auto inline-flex max-w-full min-w-0 items-center justify-center gap-[5px] rounded-full border border-[var(--color-border)] bg-[var(--color-background-tertiary)] px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-background-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)] motion-reduce:transition-none"
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
            <span>{t("chat.chatPausedDueToScroll")}</span>
          </button>
        </div>
      )}
    </div>
  );
});
