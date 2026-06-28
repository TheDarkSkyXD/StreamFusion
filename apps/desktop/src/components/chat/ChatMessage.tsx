import { Ban, Check, Clock3, Trash2, TriangleAlert } from "lucide-react";
import type React from "react";
import { memo, useMemo } from "react";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES, type TimestampFormat } from "../../shared/auth-types";
import type { ChatMessage as ChatMessageType, ContentFragment } from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ChatBadge } from "./ChatBadge";
import { ChatEmote } from "./ChatEmote";
import { ChatMessageReplyPreview, ChatPinButton, ChatReplyButton } from "./ChatReply";
import { FirstTimeChatHighlight } from "./FirstTimeChatHighlight";
import { MentionHighlight } from "./MentionHighlight";
import { formatMentionLabel } from "./mention-label";
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
  onWarn?: (message: ChatMessageType) => void;
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

const INLINE_MOD_BUTTON_CLASS =
  "inline-flex h-5 w-4 shrink-0 items-center justify-center rounded-sm text-[#d3d3d9] hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white";

function IconActionTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

const KICK_GIFT_BADGE_SET_IDS = new Set([
  "sub_gifter",
  "subgifter",
  "subgifter5",
  "subgifter25",
  "subgifter50",
  "subgifter100",
  "subgifter200",
]);

function isKickGiftBadge(setId: string | undefined): boolean {
  return setId ? KICK_GIFT_BADGE_SET_IDS.has(setId) : false;
}

function orderRenderableBadges(
  badges: ChatMessageType["badges"],
  platform: ChatMessageType["platform"]
): ChatMessageType["badges"] {
  const renderableBadges = badges.filter((badge) => badge.imageUrl);
  if (platform !== "kick") return renderableBadges;

  return renderableBadges.toSorted((a, b) => {
    if (isKickGiftBadge(a.setId) && b.setId === "subscriber") return -1;
    if (a.setId === "subscriber" && isKickGiftBadge(b.setId)) return 1;
    return 0;
  });
}

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
    default:
      return `t:${index}:${(fragment as { content?: string }).content?.slice(0, 12) ?? ""}`;
  }
}

function normalizeMentionUsername(username: string | null | undefined): string {
  return username?.trim().replace(/^@+/, "").toLowerCase() ?? "";
}

function mentionMatchesUsername(
  mentionUsername: string,
  viewerUsername: string | null | undefined
): boolean {
  const normalizedViewer = normalizeMentionUsername(viewerUsername);
  return (
    normalizedViewer.length > 0 && normalizeMentionUsername(mentionUsername) === normalizedViewer
  );
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
    onWarn,
    onBan,
    onUnban,
    onDelete,
    selfUserId,
    currentChannelContext,
  }) => {
    const cd = useAuthStore((s) => s.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
    const viewerMentionUsername = useAuthStore((s) => {
      if (message.platform === "twitch") {
        return s.twitchConnected ? s.twitchUser?.login : null;
      }

      return s.kickConnected ? (s.kickUser?.username ?? s.kickUser?.slug) : null;
    });
    // Density drives row padding + line-height; font size is applied inline so it
    // can be any px value from prefs (replacing the hardcoded `text-sm`).
    const densityClass =
      cd.density === "compact" ? "px-4 py-0 leading-[1.2]" : "px-4 py-0.5 leading-[1.35]";
    const mentionDensityClass =
      cd.density === "compact" ? "py-0 leading-[1.2]" : "py-0 leading-[1.35]";
    const fontSizeStyle = { fontSize: cd.fontSizePx };
    const isDeleted = message.isDeleted;
    const renderableBadges = useMemo(
      () => orderRenderableBadges(message.badges, message.platform),
      [message.badges, message.platform]
    );
    const mentionsViewer = useMemo(
      () =>
        message.type === "message" &&
        message.content.some(
          (fragment) =>
            fragment.type === "mention" &&
            mentionMatchesUsername(fragment.username, viewerMentionUsername)
        ),
      [message.content, message.type, viewerMentionUsername]
    );

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

    // U5 — first-time chatter chat rows now use Twitch's framed callout style.
    // System / connection / notice lines still use their existing inline
    // highlight and ignore the first-message preference.
    const showFirstTimeChatHighlight =
      message.isHighlighted && message.type === "message" && cd.firstMsgHighlight;
    const showHighlight = message.isHighlighted && message.type !== "message";
    const isFramedHighlight = mentionsViewer || showFirstTimeChatHighlight;

    // U5 — when `systemMessageEmotes` is off, emotes inside system / notice
    // lines render as their literal name instead of an image. Regular chat
    // messages are unaffected.
    const renderEmotesAsText = message.type === "system" && !cd.systemMessageEmotes;
    const isMessage = message.type === "message";
    const isOwnMessage = selfUserId !== undefined && message.userId === selfUserId;
    const senderIsProtected = message.badges.some((b) => PROTECTED_BADGE_SET_IDS.has(b.setId));
    const canShowMessageModActions = isMessage && (!senderIsProtected || isOwnMessage);
    const canReply = Boolean(onReply) && isMessage;
    const hasInlineModActions =
      canShowMessageModActions && Boolean(onBan || onTimeout || onWarn || onUnban || onDelete);

    const messageRow = (
      <div
        className={`group relative min-w-0 max-w-full overflow-x-clip ${isFramedHighlight ? mentionDensityClass : densityClass} hover:bg-white/5 ${showHighlight ? "bg-purple-500/10 border-l-2 border-purple-500" : ""} ${message.isHistorical ? "opacity-60" : ""}`}
        style={
          isFramedHighlight ? fontSizeStyle : style ? { ...style, ...fontSizeStyle } : fontSizeStyle
        }
      >
        <div
          className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]"
          data-testid="chat-message-content"
        >
          {message.replyTo && <ChatMessageReplyPreview reply={message.replyTo} />}

          {/* Timestamp - gated + format-driven by chat display prefs */}
          {cd.timestamps && <Timestamp timestamp={message.timestamp} format={cd.timestampFormat} />}

          {hasInlineModActions && (
            <span className="mr-1 inline-flex align-middle items-center gap-0.5">
              {onBan && (
                <IconActionTooltip label="Ban user">
                  <button
                    type="button"
                    onClick={() => onBan(message)}
                    className={INLINE_MOD_BUTTON_CLASS}
                    aria-label="Ban user"
                  >
                    <Ban className="h-4 w-4" strokeWidth={2.75} />
                  </button>
                </IconActionTooltip>
              )}
              {onTimeout && (
                <IconActionTooltip label="Timeout user">
                  <button
                    type="button"
                    onClick={() => onTimeout(message)}
                    className={INLINE_MOD_BUTTON_CLASS}
                    aria-label="Timeout user"
                  >
                    <Clock3 className="h-4 w-4" strokeWidth={2.75} />
                  </button>
                </IconActionTooltip>
              )}
              {onWarn && (
                <IconActionTooltip label="Warn user">
                  <button
                    type="button"
                    onClick={() => onWarn(message)}
                    className={INLINE_MOD_BUTTON_CLASS}
                    aria-label="Warn user"
                  >
                    <TriangleAlert className="h-4 w-4" strokeWidth={2.75} />
                  </button>
                </IconActionTooltip>
              )}
              {onUnban && (
                <IconActionTooltip label="Unban user">
                  <button
                    type="button"
                    onClick={() => onUnban(message)}
                    className={INLINE_MOD_BUTTON_CLASS}
                    aria-label="Unban user"
                  >
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </button>
                </IconActionTooltip>
              )}
              {onDelete && (
                <IconActionTooltip label="Delete message">
                  <button
                    type="button"
                    onClick={() => onDelete(message)}
                    className={INLINE_MOD_BUTTON_CLASS}
                    aria-label="Delete message"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2.75} />
                  </button>
                </IconActionTooltip>
              )}
            </span>
          )}

          {/* Badges */}
          {renderableBadges.length > 0 && (
            <span className="align-middle inline-flex items-center gap-1 mr-1">
              {renderableBadges.map((badge, index) => (
                <ChatBadge
                  key={`${badge.setId}-${badge.version}-${index}`}
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
            className={`align-middle min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${message.isAction ? "italic" : ""}`}
            style={message.isAction ? { color: message.color } : undefined}
          >
            {message.content.map((fragment, index) => (
              <MessageFragment
                key={fragmentKey(fragment, index)}
                fragment={fragment}
                platform={message.platform}
                renderEmotesAsText={renderEmotesAsText}
                viewerMentionUsername={viewerMentionUsername}
              />
            ))}
          </span>
        </div>

        {/* Twitch-style click-to-reply button, visible on hover/focus. */}
        {canReply && <ChatReplyButton onClick={() => onReply?.(message)} />}
        {/* Mod toolbar — each button rendered iff its callback was passed.
         *  Parent surfaces decide which callbacks to pass based on mod state. */}
        {onPin && canShowMessageModActions && (
          <ChatPinButton
            onClick={() => onPin(message)}
            rightClassName={canReply ? "right-10" : "right-2"}
          />
        )}
      </div>
    );

    if (showFirstTimeChatHighlight) {
      return (
        <FirstTimeChatHighlight style={style ? { ...style, ...fontSizeStyle } : fontSizeStyle}>
          {messageRow}
        </FirstTimeChatHighlight>
      );
    }

    if (mentionsViewer) {
      return (
        <MentionHighlight style={style ? { ...style, ...fontSizeStyle } : fontSizeStyle}>
          {messageRow}
        </MentionHighlight>
      );
    }

    return messageRow;
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
  viewerMentionUsername?: string | null;
}> = memo(({ fragment, platform, renderEmotesAsText, viewerMentionUsername }) => {
  switch (fragment.type) {
    case "text":
      return <span className="break-words [overflow-wrap:anywhere]">{fragment.content}</span>;

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
      if (mentionMatchesUsername(fragment.username, viewerMentionUsername)) {
        return (
          <span className="mx-0.5 max-w-full break-words rounded-none bg-[#f7f7f8] px-1 py-0.5 font-normal text-[#18181b] [overflow-wrap:anywhere]">
            {formatMentionLabel(fragment.username)}
          </span>
        );
      }

      return (
        <span className="max-w-full break-words [overflow-wrap:anywhere] bg-white/10 font-bold px-1 rounded mx-0.5 text-foreground">
          {formatMentionLabel(fragment.username)}
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
          className="max-w-full text-blue-400 hover:underline break-all [overflow-wrap:anywhere] cursor-pointer"
        >
          {fragment.text}
        </a>
      );

    case "cheermote":
      return (
        <span className="inline-flex max-w-full items-center mx-1 text-purple-400 font-bold">
          <img src={fragment.url} alt={fragment.name} className="h-6 w-6 max-w-full mr-1" />
          {fragment.bits}
        </span>
      );

    default:
      return null;
  }
});

MessageFragment.displayName = "MessageFragment";
