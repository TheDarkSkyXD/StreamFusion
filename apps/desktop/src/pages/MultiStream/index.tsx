import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuLayoutGrid, LuMaximize, LuMessageSquare } from "react-icons/lu";

import { ChatPanel } from "@/components/chat";
import { AddStreamDialog } from "@/components/multistream/add-stream-dialog";
import { MultiStreamGrid } from "@/components/multistream/grid-layout";
import { Button } from "@/components/ui/button";
import { useChannelByUsername } from "@/hooks/queries/useChannels";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useMultiStreamStore } from "@/store/multistream-store";

// Docked chat width is dragged in px but persisted as a % of the window so it
// scales across displays. Clamp matches the drag handler's 300–600px bounds.
const CHAT_MIN_PX = 300;
const CHAT_MAX_PX = 600;
function pctToPx(pct: number): number {
  const px = Math.round((pct / 100) * window.innerWidth);
  return Math.min(CHAT_MAX_PX, Math.max(CHAT_MIN_PX, px));
}

export function MultiStreamPage() {
  const { streams, layout, setLayout, isChatOpen, toggleChat, chatStreamId } =
    useMultiStreamStore();
  const streamsRef = useRef(streams);
  streamsRef.current = streams;

  // Chat display prefs — chatWidthPct seeds the docked width; persisted on drag
  // end. Pre-load `preferences` is null, so the raw pct is undefined until prefs
  // hydrate (see seed effect below).
  const persistedChatWidthPct = useAuthStore((s) => s.preferences?.chatDisplay?.chatWidthPct);
  const updatePreferences = useAuthStore((s) => s.updatePreferences);

  // Chat Resizing Logic (Copied from StreamPage)
  const [chatWidth, setChatWidth] = useState(() =>
    pctToPx(persistedChatWidthPct ?? DEFAULT_CHAT_DISPLAY_PREFERENCES.chatWidthPct)
  );
  const [isResizing, setIsResizing] = useState(false);
  // Latest dragged width + a one-shot seed guard (prefs load after mount).
  const chatWidthRef = useRef(chatWidth);
  const widthSeededRef = useRef(false);

  // Apply the persisted width once prefs hydrate, unless the user already dragged.
  useEffect(() => {
    if (widthSeededRef.current || persistedChatWidthPct === undefined) return;
    widthSeededRef.current = true;
    const px = pctToPx(persistedChatWidthPct);
    chatWidthRef.current = px;
    setChatWidth(px);
  }, [persistedChatWidthPct]);

  const startResizing = useCallback(() => {
    widthSeededRef.current = true; // user owns the width now; stop seeding
    setIsResizing(true);
    document.body.style.userSelect = "none";
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    document.body.style.userSelect = "";
    // Persist the final width as a % of the window; read freshest prefs from the
    // store so this callback needs no `cd` dependency (stays stable).
    const current =
      useAuthStore.getState().preferences?.chatDisplay ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
    const chatWidthPct = Math.round((chatWidthRef.current / window.innerWidth) * 100);
    if (chatWidthPct !== current.chatWidthPct) {
      void updatePreferences({ chatDisplay: { ...current, chatWidthPct } });
    }
  }, [updatePreferences]);

  const resize = useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing) {
        const newWidth = window.innerWidth - mouseMoveEvent.clientX;
        if (newWidth > CHAT_MIN_PX && newWidth < CHAT_MAX_PX) {
          chatWidthRef.current = newWidth;
          setChatWidth(newWidth);
        }
      }
    },
    [isResizing]
  );

  useEffect(() => {
    if (isResizing) {
      window.addEventListener("mousemove", resize);
      window.addEventListener("mouseup", stopResizing);
    }
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

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
  const { data: activeChatChannel } = useChannelByUsername(
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
          <>
            {/* Resize Handle */}
            <div className="relative z-20 shrink-0">
              <div
                className="absolute inset-y-0 -left-1 w-2 cursor-ew-resize"
                onMouseDown={startResizing}
              />
              <div className="w-1 h-full bg-[var(--color-border)] hover:bg-[var(--color-primary)] transition-colors" />
            </div>

            <div
              style={{ width: chatWidth }}
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
                      activeChatStream.platform === "kick"
                        ? activeChatChannel?.chatroomId
                        : undefined
                    }
                    kickUserId={
                      activeChatStream.platform === "kick"
                        ? activeChatChannel?.kickUserId
                        : undefined
                    }
                    subscriberBadges={subscriberBadges}
                  />
                ) : (
                  <p className="p-3 text-[var(--color-foreground-muted)] text-sm">
                    Select a stream to view chat
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
