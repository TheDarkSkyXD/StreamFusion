import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { LuLayoutGrid, LuMaximize, LuMessageSquare } from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";

import { ChatPanel } from "@/features/chat/components/chat/ChatPanel";
import { MergedChatFeed } from "@/features/chat/components/chat/MergedChatFeed";
import { createMultiChatChannel } from "@/features/chat/data/multi-chat-feed";
import { useMultiChatSessions } from "@/features/chat/data/use-multi-chat-sessions";
import { AddStreamDialog } from "@/features/multistream/components/multistream/add-stream-dialog";
import { MultiStreamGrid } from "@/features/multistream/components/multistream/grid-layout";
import { useChatDisplay } from "@/features/settings/data/use-chat-display";
import { Button } from "@/components/ui/button";
import { useChannelByUsername } from "@/features/discovery/data/queries/useChannels";
import { useMultiStreamStore } from "@/features/multistream/data/multistream-store";

export function MultiStreamPage() {
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
    void window.electronAPI?.slot?.setPlaybackBudget?.(playbackBudget);
  }, [playbackBudget]);

  useEffect(() => {
    return () => {
      const slot = window.electronAPI?.slot;
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
      <div className="h-14 border-b border-[var(--color-border)] flex items-center px-4 shrink-0 bg-[var(--color-background)] gap-4">
        <h1 className="font-semibold text-lg mr-auto">MultiStream</h1>

        <div className="flex items-center gap-2">
          <Button
            variant={layout === "grid" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setLayout("grid")}
            title="Grid Layout"
          >
            <LuLayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={layout === "focus" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setLayout("focus")}
            disabled={streamIds.length === 0}
            title="Focus Layout"
          >
            <LuMaximize className="h-4 w-4" />
          </Button>
        </div>

        <div className="h-6 w-px bg-[var(--color-border)] mx-2" />

        <AddStreamDialog />

        <div className="h-6 w-px bg-[var(--color-border)] mx-2" />

        <Button
          variant={isChatOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={toggleChat}
          disabled={streamIds.length === 0}
        >
          <LuMessageSquare className="h-4 w-4 mr-2" />
          Chat
        </Button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        <div className="flex-1 min-w-0 bg-[var(--color-background-tertiary)] p-1">
          <MultiStreamGrid />
        </div>

        {/* Chat Panel */}
        {isChatOpen && streamIds.length > 0 && (
          <div
            data-testid="multistream-chat-rail"
            style={{
              width: chatRailWidthPx,
              minWidth: chatRailWidthPx,
              maxWidth: chatRailWidthPx,
              boxSizing: "border-box",
            }}
            className="bg-[var(--color-background-secondary)] flex flex-col shrink-0 relative border-l border-[var(--color-border)]"
          >
            <div className="border-b border-[var(--color-border)] px-2 pt-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <h2 className="font-semibold text-sm">MultiChat</h2>
                <span
                  className="text-[11px] text-[var(--color-foreground-muted)]"
                  aria-live="polite"
                >
                  {multiChatSessions.isLoading
                    ? "Connecting"
                    : multiChatSessions.failedChannels.length > 0
                      ? `${multiChatSessions.failedChannels.length} unavailable`
                      : `${chatTabs.length} channels`}
                </span>
              </div>
              <div
                role="tablist"
                aria-label="MultiChat views"
                className="chat-scrollbar flex gap-1 overflow-x-auto pb-2"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={multiChatView === "merged"}
                  onClick={() => setMultiChatView("merged")}
                  className={
                    multiChatView === "merged"
                      ? "shrink-0 rounded-md bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-primary-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      : "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--color-foreground-muted)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  }
                >
                  Merged
                </button>
                {chatTabs.map(({ streamId, channel }) => {
                  const isSelected = multiChatView === "tabs" && activeChatStream?.id === streamId;
                  return (
                    <button
                      key={channel.key}
                      type="button"
                      role="tab"
                      aria-selected={isSelected}
                      onClick={() => selectChannelTab(channel.key)}
                      className={
                        isSelected
                          ? "shrink-0 rounded-md bg-[var(--color-background-tertiary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                          : "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--color-foreground-muted)] hover:bg-[var(--color-background-tertiary)] hover:text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      }
                    >
                      {channel.label}
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
                  Select a stream to view chat
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
