import { useEffect, useState } from "react";
import { LuMessageSquareText, LuX } from "react-icons/lu";
import type { ChatReplayPlaybackStore } from "../../hooks/chat-replay-playback-store";
import { useChatReplayPlaybackSnapshot } from "../../hooks/chat-replay-playback-store";
import { useChatReplay } from "../../hooks/use-chat-replay";
import type { Platform } from "../../shared/auth-types";
import type { ChatReplayWindowRequest } from "../../shared/chat-replay-types";
import { ChatReplayRail } from "./chat-replay-rail";

interface ChatReplaySessionProps {
  platform: Platform;
  videoId: string;
  playbackStore: ChatReplayPlaybackStore;
  locator?: ChatReplayWindowRequest["locator"];
}

type ReplayPresentation = "rail" | "drawer";

interface ReplayStatusPanelProps {
  presentation: ReplayPresentation;
  onClose?: () => void;
}

function ReplayStatusHeader({ presentation, onClose }: ReplayStatusPanelProps) {
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-[#333333] px-4">
      <h2 className="text-sm font-bold">Chat Replay</h2>
      {presentation === "drawer" && (
        <button
          type="button"
          aria-label="Close Chat Replay"
          className="ml-auto rounded-md p-1 text-[#a0a0a0] hover:bg-[#252525] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          onClick={onClose}
        >
          <LuX aria-hidden="true" className="size-4" />
        </button>
      )}
    </header>
  );
}

function ChatReplayLoadingPanel({ presentation, onClose }: ReplayStatusPanelProps) {
  return (
    <aside
      aria-label="Chat Replay"
      className={`${presentation === "drawer" ? "w-full" : "w-80"} flex h-full shrink-0 flex-col border-l border-[#333333] bg-[#1a1a1a] text-white`}
    >
      <ReplayStatusHeader presentation={presentation} onClose={onClose} />
      <div role="status" aria-label="Loading Chat Replay" className="space-y-4 px-4 py-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="space-y-2 animate-pulse motion-reduce:animate-none">
            <div className="h-3 w-2/5 rounded bg-[#2d2d2d]" />
            <div className="h-3 w-full rounded bg-[#252525]" />
          </div>
        ))}
      </div>
    </aside>
  );
}

function ChatReplayErrorPanel({
  reason,
  onRetry,
  presentation,
  onClose,
}: ReplayStatusPanelProps & { reason: string; onRetry: () => void }) {
  return (
    <aside
      aria-label="Chat Replay"
      className={`${presentation === "drawer" ? "w-full" : "w-80"} flex h-full shrink-0 flex-col border-l border-[#333333] bg-[#1a1a1a] text-white`}
    >
      <ReplayStatusHeader presentation={presentation} onClose={onClose} />
      <div role="alert" className="m-4 rounded-lg border border-[#333333] bg-[#252525] p-4">
        <p className="text-sm font-semibold">Chat Replay is temporarily unavailable.</p>
        <p className="mt-1 text-xs text-[#a0a0a0]">{reason}</p>
        <button
          type="button"
          aria-label="Retry Chat Replay"
          className="mt-4 rounded-md bg-white px-3 py-2 text-xs font-semibold text-[#0f0f0f] hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    </aside>
  );
}

export function ChatReplaySession({
  platform,
  videoId,
  playbackStore,
  locator,
}: ChatReplaySessionProps) {
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => window.innerWidth >= 1024);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const playback = useChatReplayPlaybackSnapshot(playbackStore);
  const chatReplay = useChatReplay({ platform, videoId, playback, locator });

  useEffect(() => {
    const updateLayout = () => setIsDesktopLayout(window.innerWidth >= 1024);
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  useEffect(() => {
    if (isDesktopLayout || chatReplay.result?.capability === "unsupported") {
      setIsDrawerOpen(false);
    }
  }, [chatReplay.result?.capability, isDesktopLayout]);

  if (chatReplay.result?.capability === "unsupported") return null;

  const renderReplaySurface = (presentation: ReplayPresentation) => {
    const onClose = presentation === "drawer" ? () => setIsDrawerOpen(false) : undefined;

    if (chatReplay.status === "loading") {
      return <ChatReplayLoadingPanel presentation={presentation} onClose={onClose} />;
    }

    if (chatReplay.status === "error") {
      const reason =
        chatReplay.result?.capability === "transient-failure"
          ? chatReplay.result.reason
          : "Check your connection and try again.";
      return (
        <ChatReplayErrorPanel
          reason={reason}
          onRetry={chatReplay.retry}
          presentation={presentation}
          onClose={onClose}
        />
      );
    }

    return chatReplay.result ? (
      <ChatReplayRail
        result={chatReplay.result}
        playback={playback}
        onSeek={playbackStore.requestSeek}
        presentation={presentation}
        onClose={onClose}
      />
    ) : null;
  };

  if (isDesktopLayout) return renderReplaySurface("rail");

  return (
    <div
      className={`${isDrawerOpen ? "w-[min(20rem,45vw)]" : "w-14"} flex h-full shrink-0 border-l border-[#333333] bg-[#1a1a1a] transition-[width] duration-200 motion-reduce:transition-none`}
    >
      {isDrawerOpen ? (
        <div role="dialog" aria-label="Chat Replay drawer" aria-modal="false" className="size-full">
          {renderReplaySurface("drawer")}
        </div>
      ) : (
        <button
          type="button"
          aria-label="Open Chat Replay"
          aria-expanded="false"
          className="flex size-14 items-center justify-center text-[#a0a0a0] hover:bg-[#252525] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
          onClick={() => setIsDrawerOpen(true)}
        >
          <LuMessageSquareText aria-hidden="true" className="size-5" />
        </button>
      )}
    </div>
  );
}
