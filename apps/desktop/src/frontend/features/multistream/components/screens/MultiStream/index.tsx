import { getSlotController } from "@/features/multistream/composition/slot-controller";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { LuLayoutGrid, LuMaximize, LuMessageSquare } from "react-icons/lu";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { ChatPanel } from "@/features/chat/components/chat/ChatPanel";
import { MergedChatFeed } from "@/features/chat/components/chat/MergedChatFeed";
import { createMultiChatChannel } from "@/features/chat/components/state/multi-chat-feed";
import { useMultiChatSessions } from "@/features/chat/components/hooks/use-multi-chat-sessions";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { AddStreamDialog } from "@/features/multistream/components/multistream/add-stream-dialog";
import { MultiStreamGrid } from "@/features/multistream/components/multistream/grid-layout";
import { useChatDisplay } from "@/features/settings/components/hooks/use-chat-display";
import { Button } from "@/components/ui/button";
import { useChannelByUsername } from "@/features/discovery/components/hooks/queries/useChannels";
import { useMultiStreamStore } from "@/features/multistream/components/state/multistream-store";

export function MultiStreamPage() {
  const { t } = useTranslation();
  const streamIds = useMultiStreamStore(useShallow((state) => state.streams.map(({ id }) => id)));
  const streamChatIdentities = useMultiStreamStore(
    useShallow((state) =>
      state.streams.map(
        ({ id, platform, channelName }) => `${id}\u0000${platform}\u0000${channelName}`
      )
    )
  );
  const activeChatStream = useMultiStreamStore(
    useShallow((state) => {
      const stream = state.streams.find(({ id }) => id === state.chatStreamId);
      return stream
        ? { id: stream.id, platform: stream.platform, channelName: stream.channelName }
        : null;
    })
  );
  const layout = useMultiStreamStore((state) => state.layout);
  const setLayout = useMultiStreamStore((state) => state.setLayout);
  const isChatOpen = useMultiStreamStore((state) => state.isChatOpen);
  const toggleChat = useMultiStreamStore((state) => state.toggleChat);
  const multiChatView = useMultiStreamStore((state) => state.multiChatView);
  const setMultiChatView = useMultiStreamStore((state) => state.setMultiChatView);
  const setChatStream = useMultiStreamStore((state) => state.setChatStream);
  const playbackBudget = useMultiStreamStore((state) => state.playbackBudget);
  const { cd: chatDisplay } = useChatDisplay();
  const chatRailWidthPx = chatDisplay.chatWidthPx;
  const chatRailStyle: CSSProperties & { "--chat-width": string } = {
    "--chat-width": `${chatRailWidthPx}px`,
    boxSizing: "border-box",
  };
  const streamIdsRef = useRef(streamIds);
  const chatTabs = useMemo(
    () =>
      streamChatIdentities.flatMap((identity) => {
        const [streamId, platform, channelName] = identity.split("\u0000");
        if (!streamId || (platform !== "twitch" && platform !== "kick") || !channelName) return [];
        return [
          {
            streamId,
            channel: createMultiChatChannel(platform, channelName, channelName),
          },
        ];
      }),
    [streamChatIdentities]
  );
  const chatChannels = useMemo(() => chatTabs.map(({ channel }) => channel), [chatTabs]);
  const multiChatSessions = useMultiChatSessions(chatChannels, isChatOpen);
  const selectChannelTab = useCallback(
    (channelKey: string) => {
      const tab = chatTabs.find(({ channel }) => channel.key === channelKey);
      if (!tab) return;
      setChatStream(tab.streamId);
      setMultiChatView("tabs");
    },
    [chatTabs, setChatStream, setMultiChatView]
  );
  useLayoutEffect(() => {
    streamIdsRef.current = streamIds;
  }, [streamIds]);

  useEffect(() => {
    void getSlotController()?.setPlaybackBudget?.(playbackBudget);
  }, [playbackBudget]);

  useEffect(() => {
    return () => {
      const slot = getSlotController();
      if (!slot?.destroySlot) return;
      for (const streamId of streamIdsRef.current) {
        Promise.resolve(slot.destroySlot(streamId)).catch(() => {
          /* main may already be tearing down or the slot may already be gone */
        });
      }
    };
  }, []);

  const {
    data: activeChatChannel,
    isLoading: isActiveChatChannelLoading,
    isError: isActiveChatChannelError,
    refetch: refetchActiveChatChannel,
  } = useChannelByUsername(
    activeChatStream?.channelName ?? "",
    activeChatStream?.platform ?? "twitch"
  );
  const subscriberBadges =
    activeChatStream?.platform === "kick" ? activeChatChannel?.subscriberBadges : undefined;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* MultiStream Header / Toolbar */}
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 sm:gap-4 sm:px-4">
        <h1 className="mr-auto min-w-0 font-semibold text-lg max-sm:basis-full">
          {t("multistream.multiStream")}
        </h1>

        <div className="flex items-center gap-2">
          <Button
            variant={layout === "grid" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setLayout("grid")}
            title={t("multistream.gridLayout")}
            aria-label={t("multistream.gridLayout")}
            className="max-sm:h-11 max-sm:w-11"
          >
            <LuLayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={layout === "focus" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setLayout("focus")}
            disabled={streamIds.length === 0}
            title={t("multistream.focusLayout")}
            aria-label={t("multistream.focusLayout")}
            className="max-sm:h-11 max-sm:w-11"
          >
            <LuMaximize className="h-4 w-4" />
          </Button>
        </div>

        <div className="mx-2 hidden h-6 w-px bg-[var(--color-border)] sm:block" />

        <AddStreamDialog />

        <div className="mx-2 hidden h-6 w-px bg-[var(--color-border)] sm:block" />

        <Button
          variant={isChatOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={toggleChat}
          disabled={streamIds.length === 0}
          className="max-sm:min-h-11"
        >
          <LuMessageSquare className="mr-2 h-4 w-4" />
          {t("multistream.chat")}
        </Button>
      </div>

      {/* Main Content Area */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="min-h-0 min-w-0 flex-[1_1_55%] bg-[var(--color-background-tertiary)] p-1 lg:flex-1">
          <MultiStreamGrid />
        </div>

        {/* Chat Panel */}
        {isChatOpen && streamIds.length > 0 && (
          <div
            data-testid="multistream-chat-rail"
            style={chatRailStyle}
            className="relative flex min-h-0 w-full flex-[1_1_45%] flex-col border-t border-[var(--color-border)] bg-[var(--color-background-secondary)] lg:w-[var(--chat-width)] lg:min-w-[var(--chat-width)] lg:max-w-[var(--chat-width)] lg:flex-none lg:shrink-0 lg:border-l lg:border-t-0"
          >
            <div className="border-b border-[var(--color-border)] px-2 pt-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <h2 className="font-semibold text-sm">{t("multistream.multiChat")}</h2>
                <span className="text-xs text-[var(--color-foreground-muted)]" aria-live="polite">
                  {multiChatSessions.isLoading
                    ? t("multistream.connecting")
                    : multiChatSessions.failedChannels.length > 0
                      ? t("multistream.unavailableCount", {
                          count: multiChatSessions.failedChannels.length,
                        })
                      : t("multistream.channelCount", { count: chatTabs.length })}
                </span>
              </div>
              <div
                role="tablist"
                aria-label={t("multistream.multiChatViews")}
                className="chat-scrollbar flex gap-1 overflow-x-auto pb-2"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={multiChatView === "merged"}
                  onClick={() => setMultiChatView("merged")}
                  className={
                    multiChatView === "merged"
                      ? "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background-tertiary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      : "inline-flex shrink-0 items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1.5 text-xs font-medium text-[var(--color-foreground-muted)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  }
                >
                  <LuMessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("multistream.merged")}
                </button>
                {chatTabs.map(({ streamId, channel }) => {
                  const isSelected = multiChatView === "tabs" && activeChatStream?.id === streamId;
                  const PlatformIcon = channel.platform === "twitch" ? TwitchIcon : KickIcon;
                  return (
                    <button
                      key={channel.key}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      onClick={() => selectChannelTab(channel.key)}
                      title={channel.label}
                      className={
                        isSelected
                          ? "inline-flex max-w-40 shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-background-tertiary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                          : "inline-flex max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--color-foreground-muted)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      }
                    >
                      <span className="shrink-0" aria-hidden="true">
                        <PlatformIcon
                          size={12}
                          className={
                            channel.platform === "twitch" ? "text-[#a970ff]" : "text-[#53fc18]"
                          }
                        />
                      </span>
                      <span className="truncate">{channel.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              {multiChatView === "merged" ? (
                <MergedChatFeed channels={chatChannels} onSelectChannel={selectChannelTab} />
              ) : activeChatStream ? (
                <ChatPanel
                  initialPlatform={activeChatStream.platform}
                  initialChannel={activeChatStream.channelName}
                  channelId={activeChatChannel?.id}
                  chatroomId={
                    activeChatStream.platform === "kick" ? activeChatChannel?.chatroomId : undefined
                  }
                  kickUserId={
                    activeChatStream.platform === "kick" ? activeChatChannel?.kickUserId : undefined
                  }
                  isPartnerChannel={
                    activeChatStream.platform === "kick" ? activeChatChannel?.isPartner : undefined
                  }
                  subscriberBadges={subscriberBadges}
                  badgeCatalogState={
                    activeChatStream.platform !== "kick"
                      ? undefined
                      : isActiveChatChannelLoading
                        ? "loading"
                        : isActiveChatChannelError
                          ? "failed"
                          : "ready"
                  }
                  retryBadgeCatalog={() => void refetchActiveChatChannel()}
                />
              ) : (
                <p className="p-3 text-[var(--color-foreground-muted)] text-sm">
                  {t("multistream.selectStreamToViewChat")}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
