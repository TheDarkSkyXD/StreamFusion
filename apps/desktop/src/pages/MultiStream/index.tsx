import { useEffect, useMemo, useRef } from "react";
import { LuLayoutGrid, LuMaximize, LuMessageSquare } from "react-icons/lu";

import { ChatPanel } from "@/components/chat";
import { AddStreamDialog } from "@/components/multistream/add-stream-dialog";
import { MultiStreamGrid } from "@/components/multistream/grid-layout";
import { Button } from "@/components/ui/button";
import { useChannelByUsername } from "@/hooks/queries/useChannels";
import { useMultiStreamStore } from "@/store/multistream-store";

const CHAT_CONTENT_WIDTH_PX = 340;
const CHAT_BORDER_WIDTH_PX = 1;
const CHAT_RAIL_WIDTH_PX = CHAT_CONTENT_WIDTH_PX + CHAT_BORDER_WIDTH_PX;

export function MultiStreamPage() {
  const { streams, layout, setLayout, isChatOpen, toggleChat, chatStreamId } =
    useMultiStreamStore();
  const streamsRef = useRef(streams);
  streamsRef.current = streams;

  useEffect(() => {
    return () => {
      const slot = window.electronAPI?.slot;
      if (!slot?.destroySlot) return;
      for (const stream of streamsRef.current) {
        Promise.resolve(slot.destroySlot(stream.id)).catch(() => {
          /* main may already be tearing down or the slot may already be gone */
        });
      }
    };
  }, []);

  const activeChatStream = streams.find((s) => s.id === chatStreamId);
  const {
    data: activeChatChannel,
    isLoading: isActiveChatChannelLoading,
    isError: isActiveChatChannelError,
    refetch: refetchActiveChatChannel,
  } = useChannelByUsername(
    activeChatStream?.channelName ?? "",
    activeChatStream?.platform ?? "twitch"
  );
  const subscriberBadges = useMemo(
    () => (activeChatStream?.platform === "kick" ? activeChatChannel?.subscriberBadges : undefined),
    [activeChatStream?.platform, activeChatChannel?.subscriberBadges]
  );

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
            disabled={streams.length === 0}
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
          disabled={streams.length === 0}
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
        {isChatOpen && streams.length > 0 && (
          <div
            data-testid="multistream-chat-rail"
            style={{
              width: CHAT_RAIL_WIDTH_PX,
              minWidth: CHAT_RAIL_WIDTH_PX,
              maxWidth: CHAT_RAIL_WIDTH_PX,
            }}
            className="bg-[var(--color-background-secondary)] flex flex-col shrink-0 relative border-l border-[var(--color-border)]"
          >
            <div className="p-3 border-b border-[var(--color-border)] flex justify-between items-center">
              <h2 className="font-semibold text-sm">
                Chat:{" "}
                <span className="text-[var(--color-primary)]">
                  {activeChatStream?.channelName || "Control"}
                </span>
              </h2>
            </div>
            <div className="flex-1 min-h-0">
              {activeChatStream ? (
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
