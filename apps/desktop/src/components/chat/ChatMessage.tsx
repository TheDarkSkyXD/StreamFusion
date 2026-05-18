import type React from "react";
import { memo, useMemo } from "react";
import {
  BsHammer,
  BsHourglassSplit,
  BsPinAngleFill,
  BsReplyFill,
  BsTrashFill,
  BsUnlock,
} from "react-icons/bs";
import type { ChatMessage as ChatMessageType, ContentFragment } from "../../shared/chat-types";
import { ChatBadge } from "./ChatBadge";
import { ChatEmote } from "./ChatEmote";
import { Username, type UsernameChannelContext } from "./Username";

interface ChatMessageProps {
  message: ChatMessageType;
  style?: React.CSSProperties;
  onReply?: (message: ChatMessageType) => void;
  /** Optional pin action — when provided, a hover Pin button is rendered on
   *  Twitch chat messages. TwitchChat passes this only when the signed-in
   *  user moderates the current channel. */
  onPin?: (message: ChatMessageType) => void;
  // U10 additions — each parent passes only when the action is applicable for
  // the signed-in mod identity. ChatMessage stays unaware of mod state itself.
  onTimeout?: (message: ChatMessageType) => void;
  onBan?: (message: ChatMessageType) => void;
  onUnban?: (message: ChatMessageType) => void;
  onDelete?: (message: ChatMessageType) => void;
  /** The signed-in user's id. Used to recognize "own messages" so they still
   *  show the toolbar even though they may carry a moderator badge. */
  selfUserId?: string;
  /** U18 — when provided, clicking the message's Username opens the popout
   *  bound to this channel context. Surfaces without a channel omit it. */
  currentChannelContext?: UsernameChannelContext;
}

/** Sender badges that protect the user from moderation actions. Toolbar is
 *  hidden when the sender carries any of these — except when it's the
 *  signed-in user's own message (AE2). */
const PROTECTED_BADGE_SET_IDS = new Set([
  "broadcaster",
  "moderator",
  "staff",
  "admin",
  "global_mod",
]);

const TOOLBAR_BUTTON_CLASS =
  "opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-opacity";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

// Content-derived keys preserve child state across deletions/edits.
function fragmentKey(fragment: ContentFragment, index: number): string {
  switch (fragment.type) {
    case "emote":
      return `e:${fragment.id}:${index}`;
    case "mention":
      return `m:${fragment.username}:${index}`;
    case "link":
      return `l:${index}:${fragment.url.slice(0, 24)}`;
    case "cheermote":
      return `c:${fragment.id}:${fragment.bits}:${index}`;
    case "text":
    default:
      return `t:${index}:${(fragment as { content?: string }).content?.slice(0, 12) ?? ""}`;
  }
}

/**
 * ChatMessage Component - Performance Optimized
 *
 * Uses React.memo to prevent unnecessary re-renders when message data hasn't changed.
 * Timestamp is memoized to avoid recalculating on every render.
 */
export const ChatMessage: React.FC<ChatMessageProps> = memo(({
  message,
  style,
  onReply,
  onPin,
  onTimeout,
  onBan,
  onUnban,
  onDelete,
  selfUserId,
  currentChannelContext,
}) => {
  const isDeleted = message.isDeleted;

  if (message.type === "ban" && message.banInfo) {
    const { bannedUsername, bannedByUsername, lastMessage, duration } = message.banInfo;
    const actionText = duration ? `timed out for ${formatDuration(duration)}` : "permanently banned";
    return (
      <div
        className="mx-2 my-1 px-3 py-2 rounded-md border border-red-500/30 bg-red-950/40 text-sm"
        style={style}
      >
        <div className="flex items-start gap-2">
          <span className="text-red-400 flex-shrink-0">🚫</span>
          <div className="min-w-0">
            <span className="font-bold text-red-400">{bannedUsername}</span>
            <span className="text-gray-300"> was {actionText}</span>
            {bannedByUsername && (
              <span className="text-gray-400"> by {bannedByUsername}</span>
            )}
            {lastMessage && (
              <div className="text-gray-500 italic text-xs mt-0.5 truncate">
                Last: {lastMessage}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isDeleted) {
    return (
      <div className="px-4 py-1 text-sm text-gray-500 italic opacity-50" style={style}>
        Message deleted
      </div>
    );
  }

  return (
    <div
      className={`group relative px-4 py-1 text-sm hover:bg-white/5 leading-[1.4] ${message.isHighlighted ? "bg-purple-500/10 border-l-2 border-purple-500" : ""} ${message.isHistorical ? "opacity-60" : ""}`}
      style={style}
    >
      <div className="break-words">
        {/* Timestamp - memoized to prevent recalculation */}
        <Timestamp timestamp={message.timestamp} />

        {/* Badges */}
        {message.badges.length > 0 && (
          <span className="align-middle inline-block mr-1">
            {message.badges
              .filter((badge) => badge.imageUrl)
              .map((badge, index) => (
                <ChatBadge
                  key={`${badge.setId}-${index}`}
                  badge={badge}
                  platform={message.platform}
                />
              ))}
          </span>
        )}

        {/* Username */}
        <span className="align-middle inline">
          <Username
            userId={message.userId}
            username={message.username}
            displayName={message.displayName}
            color={message.color}
            platform={message.platform}
            className="align-middle"
            currentChannelContext={currentChannelContext}
          />
        </span>

        {/* Separator for regular messages */}
        {!message.isAction && <span className="mr-1 align-middle">:</span>}

        {/* Content */}
        <span
          className={`align-middle ${message.isAction ? "italic" : ""}`}
          style={message.isAction ? { color: message.color } : undefined}
        >
          {message.content.map((fragment, index) => (
            <MessageFragment
              key={fragmentKey(fragment, index)}
              fragment={fragment}
              platform={message.platform}
            />
          ))}
        </span>
      </div>

      {/* Reply button — Kick only, visible on hover */}
      {onReply && message.platform === "kick" && message.type === "message" && (
        <button
          type="button"
          onClick={() => onReply(message)}
          className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-opacity"
          title="Reply"
        >
          <BsReplyFill size={13} />
        </button>
      )}
      {/* Mod toolbar — each button rendered iff its callback was passed.
       *  Parent surfaces decide which callbacks to pass based on mod state. */}
      {(() => {
        const hasAnyAction = Boolean(
          onPin || onTimeout || onBan || onUnban || onDelete
        );
        if (!hasAnyAction || message.type !== "message") return null;

        const isOwnMessage =
          selfUserId !== undefined && message.userId === selfUserId;
        const senderIsProtected = message.badges.some((b) =>
          PROTECTED_BADGE_SET_IDS.has(b.setId)
        );
        if (senderIsProtected && !isOwnMessage) return null;

        return (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {onTimeout && (
              <button
                type="button"
                onClick={() => onTimeout(message)}
                className={TOOLBAR_BUTTON_CLASS}
                title="Timeout user"
                aria-label="Timeout user"
              >
                <BsHourglassSplit size={13} />
              </button>
            )}
            {onBan && (
              <button
                type="button"
                onClick={() => onBan(message)}
                className={TOOLBAR_BUTTON_CLASS}
                title="Ban user"
                aria-label="Ban user"
              >
                <BsHammer size={13} />
              </button>
            )}
            {onUnban && (
              <button
                type="button"
                onClick={() => onUnban(message)}
                className={TOOLBAR_BUTTON_CLASS}
                title="Unban user"
                aria-label="Unban user"
              >
                <BsUnlock size={13} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(message)}
                className={TOOLBAR_BUTTON_CLASS}
                title="Delete message"
                aria-label="Delete message"
              >
                <BsTrashFill size={13} />
              </button>
            )}
            {onPin && (
              <button
                type="button"
                onClick={() => onPin(message)}
                className={TOOLBAR_BUTTON_CLASS}
                title="Pin message"
                aria-label="Pin message"
              >
                <BsPinAngleFill size={13} />
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
});

ChatMessage.displayName = "ChatMessage";

// Memoized timestamp component
const Timestamp: React.FC<{ timestamp: Date }> = memo(({ timestamp }) => {
  const formattedTime = useMemo(() => {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [timestamp]);

  return (
    <span className="text-xs text-white font-bold mr-1 select-none align-middle inline-block">
      {formattedTime}
    </span>
  );
});

Timestamp.displayName = "Timestamp";

// Memoized message fragment component
const MessageFragment: React.FC<{ fragment: ContentFragment; platform: "twitch" | "kick" }> = memo(
  ({ fragment, platform }) => {
    switch (fragment.type) {
      case "text":
        return <span>{fragment.content}</span>;

      case "emote":
        return (
          <ChatEmote
            id={fragment.id}
            name={fragment.name}
            url={fragment.url}
            platform={platform}
            isAnimated={fragment.isAnimated}
          />
        );

      case "mention":
        return (
          <span className="bg-white/10 font-bold px-1 rounded mx-0.5 text-white">
            {fragment.username}
          </span>
        );

      case "link":
        return (
          <a
            href={fragment.url}
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI.openExternal(fragment.url);
            }}
            className="text-blue-400 hover:underline break-all cursor-pointer"
          >
            {fragment.text}
          </a>
        );

      case "cheermote":
        return (
          <span className="inline-flex items-center mx-1 text-purple-400 font-bold">
            <img src={fragment.url} alt={fragment.name} className="h-6 w-6 mr-1" />
            {fragment.bits}
          </span>
        );

      default:
        return null;
    }
  }
);

MessageFragment.displayName = "MessageFragment";
