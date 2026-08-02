import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { LuChevronLeft, LuChevronRight, LuClock3, LuX } from "react-icons/lu";
import { selectVisibleChatReplayMessages } from "../../hooks/chat-replay-window";
import { isAllowedPlatformImageUrl } from "../../lib/proxied-image-url";
import type { Platform } from "../../shared/auth-types";
import type {
  ChatReplayBadge,
  ChatReplayFragment,
  ChatReplaySender,
  ChatReplayWindowResult,
  VideoPlaybackSnapshot,
} from "../../shared/chat-replay-types";
import { Username } from "../chat/Username";
import { ProxiedImage } from "../ui/proxied-image";

interface ChatReplayRailProps {
  result: ChatReplayWindowResult;
  playback: VideoPlaybackSnapshot;
  onSeek?: (offsetSeconds: number) => void;
  presentation?: "rail" | "drawer";
  onClose?: () => void;
}

function formatOffset(offsetSeconds: number): string {
  const hours = Math.floor(offsetSeconds / 3600);
  const minutes = Math.floor((offsetSeconds % 3600) / 60);
  const seconds = Math.floor(offsetSeconds % 60);
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    : `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const RICH_TEXT_TOKEN = /(https?:\/\/[^\s]+|@[a-zA-Z0-9_]+)/g;

function getHistoricalSenderColor(sender: ChatReplaySender): string | undefined {
  return sender.color && sender.color.length > 0 ? sender.color : undefined;
}

function getResolvedBadge(
  badge: ChatReplayBadge,
  platform: Platform
): { imageUrl?: string; title: string } {
  const imageUrl = badge.imageUrl && badge.imageUrl.length > 0 ? badge.imageUrl : undefined;
  return {
    imageUrl: imageUrl && isAllowedPlatformImageUrl(imageUrl, platform) ? imageUrl : undefined,
    title: badge.title && badge.title.length > 0 ? badge.title : `${badge.setId} badge`,
  };
}

function getResolvedEmoteUrl(
  fragment: Extract<ChatReplayFragment, { type: "emote" }>,
  platform: Platform
): string | undefined {
  return fragment.url && isAllowedPlatformImageUrl(fragment.url, platform)
    ? fragment.url
    : undefined;
}

function renderTextFragment(text: string, fragmentKey: string): ReactNode[] {
  return text
    .split(RICH_TEXT_TOKEN)
    .filter(Boolean)
    .map((token, tokenIndex) => {
      const key = `${fragmentKey}-${tokenIndex}`;
      if (token.startsWith("http://") || token.startsWith("https://")) {
        return (
          <a
            key={key}
            href={token}
            target="_blank"
            rel="noreferrer"
            className="underline decoration-[#666666] underline-offset-2 hover:decoration-white"
          >
            {token}
          </a>
        );
      }
      if (token.startsWith("@")) {
        return (
          <span key={key} aria-label={`Mention ${token}`} className="font-semibold text-[#b2b2b2]">
            {token}
          </span>
        );
      }
      return token;
    });
}

export function ChatReplayRail({
  result,
  playback,
  onSeek,
  presentation = "rail",
  onClose,
}: ChatReplayRailProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [browsingOffset, setBrowsingOffset] = useState<number | null>(null);
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null);
  const messageLogRef = useRef<HTMLDivElement>(null);

  const replayOffset = browsingOffset ?? playback.currentTime;
  const visibleMessages =
    result.capability === "supported"
      ? selectVisibleChatReplayMessages(result.messages, {
          ...playback,
          currentTime: replayOffset,
        })
      : [];

  useLayoutEffect(() => {
    const messageLog = messageLogRef.current;
    if (messageLog && browsingOffset === null && visibleMessages.length > 0) {
      messageLog.scrollTop = messageLog.scrollHeight;
    }
  }, [browsingOffset, visibleMessages.length]);

  if (result.capability !== "supported" && result.capability !== "empty") return null;

  if (presentation === "rail" && isCollapsed) {
    return (
      <aside
        aria-label="Chat Replay collapsed"
        className="flex h-full w-14 shrink-0 flex-col items-center border-l border-[#333333] bg-[#1a1a1a] py-3 text-white"
      >
        <button
          type="button"
          aria-label="Expand Chat Replay"
          aria-expanded="false"
          className="rounded-md p-2 text-[#a0a0a0] hover:bg-[#252525] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          onClick={() => setIsCollapsed(false)}
        >
          <LuChevronLeft aria-hidden="true" className="size-5" />
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Chat Replay"
      className={`${presentation === "drawer" ? "w-full" : "w-80"} flex h-full shrink-0 flex-col border-l border-[#333333] bg-[#1a1a1a] text-white`}
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[#333333] px-4">
        <LuClock3 aria-hidden="true" className="size-4 text-[#a0a0a0]" />
        <h2 className="text-sm font-bold">Chat Replay</h2>
        <span className="ml-auto text-xs tabular-nums text-[#a0a0a0]">
          {formatOffset(playback.currentTime)}
        </span>
        {presentation === "drawer" ? (
          <button
            type="button"
            aria-label="Close Chat Replay"
            className="rounded-md p-1 text-[#a0a0a0] hover:bg-[#252525] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={onClose}
          >
            <LuX aria-hidden="true" className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Collapse Chat Replay"
            aria-expanded="true"
            className="rounded-md p-1 text-[#a0a0a0] hover:bg-[#252525] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={() => setIsCollapsed(true)}
          >
            <LuChevronRight aria-hidden="true" className="size-4" />
          </button>
        )}
      </header>

      {browsingOffset !== null && (
        <button
          type="button"
          className="mx-3 mt-3 rounded-md bg-[#252525] px-3 py-2 text-xs font-semibold text-white hover:bg-[#2d2d2d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          aria-label={`Return to ${formatOffset(playback.currentTime)}`}
          onClick={() => setBrowsingOffset(null)}
        >
          Return to {formatOffset(playback.currentTime)}
        </button>
      )}

      <div
        ref={messageLogRef}
        aria-label="Chat Replay messages"
        className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-3"
        role="log"
        onScroll={(event) => {
          const messageLog = event.currentTarget;
          const distanceFromBottom =
            messageLog.scrollHeight - messageLog.scrollTop - messageLog.clientHeight;
          if (distanceFromBottom > 24 && browsingOffset === null) {
            setBrowsingOffset(playback.currentTime);
          }
        }}
      >
        {result.capability === "empty" ? (
          <p
            role="status"
            aria-label="Chat Replay window empty"
            className="px-2 py-8 text-center text-sm text-[#a0a0a0]"
          >
            No archived messages were found near this point.
          </p>
        ) : visibleMessages.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-[#a0a0a0]">
            No messages at this moment.
          </p>
        ) : (
          <ol className="min-w-0 max-w-full space-y-2">
            {visibleMessages.map((message) => (
              <li
                key={message.id}
                className="min-w-0 max-w-full overflow-hidden rounded-md px-2 py-1.5 hover:bg-[#252525]"
              >
                <div className="flex min-w-0 max-w-full items-center gap-2 text-xs">
                  <button
                    type="button"
                    aria-label={`Seek to ${formatOffset(message.offsetSeconds)}`}
                    className="shrink-0 rounded-sm tabular-nums text-[#a0a0a0] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    disabled={!onSeek}
                    onClick={() => onSeek?.(message.offsetSeconds)}
                  >
                    <time>{formatOffset(message.offsetSeconds)}</time>
                  </button>
                  <span className="flex shrink-0 items-center gap-1">
                    {message.badges.map((badge) => {
                      const { imageUrl, title } = getResolvedBadge(badge, result.platform);
                      return (
                        <span
                          key={`${badge.setId}-${badge.version}-${badge.id}`}
                          title={title}
                          className="inline-flex size-4"
                        >
                          <ProxiedImage
                            src={imageUrl}
                            alt={title}
                            proxy={result.platform}
                            width={16}
                            height={16}
                            className="size-4 object-contain"
                            loading="lazy"
                            fallback={
                              <span
                                aria-label={`${title} unavailable`}
                                className="inline-flex size-4 items-center justify-center rounded-sm bg-[#2d2d2d] text-[9px] font-bold uppercase text-[#b2b2b2]"
                              >
                                {badge.setId.charAt(0)}
                              </span>
                            }
                          />
                        </span>
                      );
                    })}
                  </span>
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <Username
                      userId={message.sender.id}
                      username={message.sender.login}
                      displayName={message.sender.displayName}
                      color={getHistoricalSenderColor(message.sender)}
                      platform={result.platform}
                      className="block truncate"
                      noWrap
                      onClick={() =>
                        setExpandedMessageId((current) =>
                          current === message.id ? null : message.id
                        )
                      }
                    />
                  </span>
                </div>
                {expandedMessageId === message.id && (
                  <div className="mt-1 min-w-0 break-words rounded-md bg-[#252525] px-2 py-1.5 text-xs text-[#b2b2b2] [overflow-wrap:anywhere]">
                    <span className="font-semibold text-white">{message.sender.displayName}</span>
                    <span className="ml-2">@{message.sender.login}</span>
                  </div>
                )}
                <p className="mt-0.5 min-w-0 max-w-full break-words text-sm leading-5 text-[#efeff1] [overflow-wrap:anywhere]">
                  {message.fragments.map((fragment, fragmentIndex) => {
                    if (fragment.type === "emote") {
                      const emoteUrl = getResolvedEmoteUrl(fragment, result.platform);
                      return emoteUrl ? (
                        <ProxiedImage
                          key={`${message.id}-emote-${fragmentIndex}`}
                          src={emoteUrl}
                          alt={fragment.text}
                          proxy={result.platform}
                          width={28}
                          height={28}
                          className="mx-0.5 inline-block size-7 object-contain align-middle"
                          loading="lazy"
                          fallback={
                            <span className="mx-0.5 inline-block font-semibold text-[#b2b2b2]">
                              {fragment.text}
                            </span>
                          }
                        />
                      ) : (
                        <span
                          key={`${message.id}-emote-${fragmentIndex}`}
                          className="mx-0.5 inline-block font-semibold text-[#b2b2b2]"
                        >
                          {fragment.text}
                        </span>
                      );
                    }
                    return renderTextFragment(fragment.text, `${message.id}-text-${fragmentIndex}`);
                  })}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
