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
import { DEFAULT_CHAT_DISPLAY_PREFERENCES, type TimestampFormat } from "../../shared/auth-types";
import type { ChatMessage as ChatMessageType, ContentFragment } from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
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
  "opacity-0 group-hover:opacity-100 p-1 rounded text-foreground-secondary hover:text-foreground hover:bg-white/10 transition-opacity";

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
export const ChatMessage: React.FC<ChatMessageProps> = memo(
  ({
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
    const cd = useAuthStore((s) => s.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
    // Density drives row padding + line-height; font size is applied inline so it
    // can be any px value from prefs (replacing the hardcoded `text-sm`).
    const densityClass =
      cd.density === "compact" ? "px-4 py-0.5 leading-[1.2]" : "px-4 py-1 leading-[1.4]";
    const fontSizeStyle = { fontSize: cd.fontSizePx };
    const isDeleted = message.isDeleted;

    if (message.type === "ban" && message.banInfo) {
      // U5 — the timeout/ban notice belongs to the clear-chat event family
      // (emitted as a ClearChat with a targetUserId). When the viewer has
      // disabled chat-clear notices, suppress the whole line.
      if (!cd.showClearChat) return null;
      const { bannedUsername, bannedByUsername, lastMessage, duration } = message.banInfo;
      const actionText = duration
        ? `timed out for ${formatDuration(duration)}`
        : "permanently banned";
      return (
        <div
          className="mx-2 my-1 px-3 py-2 rounded-md border border-red-500/30 bg-red-950/40 text-sm"
          style={style}
        >
          <div className="flex items-start gap-2">
            <span className="text-red-400 flex-shrink-0">🚫</span>
            <div className="min-w-0">
              <span className="font-bold text-red-400">{bannedUsername}</span>
              <span className="text-foreground-secondary"> was {actionText}</span>
              {bannedByUsername && (
                <span className="text-foreground-secondary"> by {bannedByUsername}</span>
              )}
              {lastMessage && (
                <div className="text-foreground-muted italic text-xs mt-0.5 truncate">
                  Last: {lastMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (isDeleted) {
      // U5 — the "Message deleted" tombstone is the single-message-deletion
      // notice. When the viewer has disabled it, drop the row entirely rather
      // than leaving a placeholder.
      if (!cd.showClearMsg) return null;
      return (
        <div className="px-4 py-1 text-sm text-foreground-muted italic opacity-50" style={style}>
          Message deleted
        </div>
      );
    }

    // U5 — first-time-chatter highlight. `isHighlighted` also marks system /
    // connection / notice lines (which set it for their own styling); the
    // viewer toggle only governs the highlight on real chat messages, so gate
    // on `type === "message"` to leave system-line styling untouched.
    const showHighlight =
      message.isHighlighted && (message.type !== "message" || cd.firstMsgHighlight);

    // U5 — when `systemMessageEmotes` is off, emotes inside system / notice
    // lines render as their literal name instead of an image. Regular chat
    // messages are unaffected.
    const renderEmotesAsText = message.type === "system" && !cd.systemMessageEmotes;

    return (
      <div
        className={`group relative ${densityClass} hover:bg-white/5 ${showHighlight ? "bg-purple-500/10 border-l-2 border-purple-500" : ""} ${message.isHistorical ? "opacity-60" : ""}`}
        style={style ? { ...style, ...fontSizeStyle } : fontSizeStyle}
      >
        <div className="break-words">
          {/* Timestamp - gated + format-driven by chat display prefs */}
          {cd.timestamps && <Timestamp timestamp={message.timestamp} format={cd.timestampFormat} />}

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
                renderEmotesAsText={renderEmotesAsText}
              />
            ))}
          </span>
        </div>

        {/* Reply button — Kick only, visible on hover */}
        {onReply && message.platform === "kick" && message.type === "message" && (
          <button
            type="button"
            onClick={() => onReply(message)}
            className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded text-foreground-secondary hover:text-foreground hover:bg-white/10 transition-opacity"
            title="Reply"
          >
            <BsReplyFill size={13} />
          </button>
        )}
        {/* Mod toolbar — each button rendered iff its callback was passed.
         *  Parent surfaces decide which callbacks to pass based on mod state. */}
        {(() => {
          const hasAnyAction = Boolean(onPin || onTimeout || onBan || onUnban || onDelete);
          if (!hasAnyAction || message.type !== "message") return null;

          const isOwnMessage = selfUserId !== undefined && message.userId === selfUserId;
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
  }
);

ChatMessage.displayName = "ChatMessage";

// Memoized timestamp component. Format follows `chatDisplay.timestampFormat`:
// "HH:mm" = 24-hour (hour12:false), "h:mm a" = 12-hour with AM/PM.
const Timestamp: React.FC<{ timestamp: Date; format: TimestampFormat }> = memo(
  ({ timestamp, format }) => {
    const formattedTime = useMemo(() => {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: format === "h:mm a" ? "numeric" : "2-digit",
        minute: "2-digit",
        hour12: format === "h:mm a",
      });
    }, [timestamp, format]);

    return (
      <span className="text-xs text-foreground font-bold mr-1 select-none align-middle inline-block">
        {formattedTime}
      </span>
    );
  }
);

Timestamp.displayName = "Timestamp";

// Memoized message fragment component
const MessageFragment: React.FC<{
  fragment: ContentFragment;
  platform: "twitch" | "kick";
  /** U5 — render emote fragments as their literal name (system-message-emotes off). */
  renderEmotesAsText?: boolean;
}> = memo(({ fragment, platform, renderEmotesAsText }) => {
  switch (fragment.type) {
    case "text":
      return <span>{fragment.content}</span>;

    case "emote":
      if (renderEmotesAsText) {
        return <span>{fragment.name}</span>;
      }
      return (
        <ChatEmote
          id={fragment.id}
          name={fragment.name}
          url={fragment.url}
          platform={platform}
          isAnimated={fragment.isAnimated}
          isZeroWidth={fragment.isZeroWidth}
        />
      );

    case "mention":
      return (
        <span className="bg-white/10 font-bold px-1 rounded mx-0.5 text-foreground">
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
});

MessageFragment.displayName = "MessageFragment";
