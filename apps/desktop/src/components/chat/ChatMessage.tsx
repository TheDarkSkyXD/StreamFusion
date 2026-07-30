import { Ban, Check, Clock3, Trash2, TriangleAlert } from "lucide-react";
import type React from "react";
import { memo, useMemo, useState } from "react";
import {
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  type DeletedMessageDisplayMode,
  type TimestampFormat,
} from "../../shared/auth-types";
import type {
  ChatHighlightKind,
  ChatMessage as ChatMessageType,
  ChatPlatform,
  ContentFragment,
} from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { BitsHighlight } from "./BitsHighlight";
import { ChatBadge } from "./ChatBadge";
import { ChatEmote } from "./ChatEmote";
import {
  TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS,
  TWITCH_CHAT_ACTION_TOOLTIP_CLASS,
  TWITCH_MESSAGE_ACTION_CLUSTER_CLASS,
} from "./ChatMessageActionStyles";
import { ChatPinButton } from "./ChatPinButton";
import { ChatMessageReplyPreview } from "./ChatReply";
import { ChatReplyButton } from "./ChatReplyButton";
import { CheerHighlight } from "./CheerHighlight";
import { DeletedMessageHighlight } from "./DeletedMessageHighlight";
import { FirstTimeChatHighlight } from "./FirstTimeChatHighlight";
import { GiftedSubHighlight } from "./GiftedSubHighlight";
import { HighlightedMessageHighlight } from "./HighlightedMessageHighlight";
import { MentionHighlight } from "./MentionHighlight";
import { ModerationActionHighlightCompact } from "./ModerationActionHighlightCompact";
import { ModerationActionHighlightCozy } from "./ModerationActionHighlightCozy";
import { ModeratorHighlight } from "./ModeratorHighlight";
import { formatMentionLabel } from "./mention-label";
import { RaidHighlight } from "./RaidHighlight";
import { ResubHighlight } from "./ResubHighlight";
import { RitualHighlight } from "./RitualHighlight";
import { SubscriptionHighlight } from "./SubscriptionHighlight";
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
  /** Cap visible sender badges without changing the underlying message snapshot. */
  badgeLimit?: number;
  /** Disable nested username interaction when a containing surface owns selection. */
  embedded?: boolean;
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
  "inline-flex h-5 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-[#d3d3d9] hover:bg-[rgba(83,83,95,0.48)] hover:text-white active:bg-[rgba(83,83,95,0.55)] focus:outline-none focus-visible:ring-1 focus-visible:ring-white";

function IconActionTooltip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="top"
        className={TWITCH_CHAT_ACTION_TOOLTIP_CLASS}
        arrowClassName={TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS}
      >
        {label}
      </TooltipContent>
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

const USER_ATTRIBUTED_EVENT_KINDS = new Set<ChatHighlightKind>([
  "subscription",
  "resub",
  "gifted-sub",
  "raid",
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

function deletedMessageDisplayMode(
  mode: DeletedMessageDisplayMode | undefined
): DeletedMessageDisplayMode {
  return mode ?? DEFAULT_CHAT_DISPLAY_PREFERENCES.deletedMessageDisplay;
}

function hasRetainedDeletedContent(message: ChatMessageType): boolean {
  return (
    message.content.length > 0 ||
    Boolean(message.rawContent && message.rawContent.trim().length > 0)
  );
}

function formatModerationTimestamp(
  timestamp: Date | number | undefined,
  mode: DeletedMessageDisplayMode
): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (mode === "compact") {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (mode === "audit") {
    return `${date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}, ${date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  return null;
}

function renderBadgeList(
  badges: ChatMessageType["badges"],
  platform: ChatMessageType["platform"]
): React.ReactNode {
  if (badges.length === 0) return null;

  return (
    <span className="inline-flex shrink-0 items-center gap-1 align-middle [&_img]:!mr-0">
      {badges.map((badge, index) => (
        <ChatBadge
          key={`${badge.setId}-${badge.version}-${index}`}
          badge={badge}
          platform={platform}
        />
      ))}
    </span>
  );
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

function isKickChannelBroadcasterMessage(
  message: ChatMessageType,
  currentChannelContext: UsernameChannelContext | undefined
): boolean {
  if (message.platform !== "kick") return false;

  const channelSlug = normalizeMentionUsername(currentChannelContext?.channelSlug);
  if (!channelSlug) return false;

  return [message.username, message.displayName].some(
    (name) => normalizeMentionUsername(name) === channelSlug
  );
}

function getEventHighlightKind(message: ChatMessageType): ChatHighlightKind | undefined {
  if (message.highlightKind) {
    return message.highlightKind;
  }

  if (message.type === "bits") {
    return "cheer";
  }

  return undefined;
}

function splitLeadingEventUsername(
  content: string,
  displayName: string,
  username: string
): string | null {
  const candidates = [displayName, username]
    .map((name) => name.trim())
    .filter((name, index, names) => name.length > 0 && names.indexOf(name) === index)
    .sort((a, b) => b.length - a.length);
  const lowerContent = content.toLowerCase();

  for (const candidate of candidates) {
    if (!lowerContent.startsWith(candidate.toLowerCase())) continue;
    return content.slice(candidate.length);
  }

  return null;
}

function capitalizeEventAction(content: string): string {
  const trimmed = content.trimStart();
  return trimmed ? `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}` : "";
}

function EventHighlight({
  children,
  kind,
  platform,
  style,
}: {
  children: React.ReactNode;
  kind: Exclude<ChatHighlightKind, "first-time-chat">;
  platform: ChatPlatform;
  style?: React.CSSProperties;
}) {
  switch (kind) {
    case "subscription":
      return (
        <SubscriptionHighlight platform={platform} style={style}>
          {children}
        </SubscriptionHighlight>
      );
    case "resub":
      return (
        <ResubHighlight platform={platform} style={style}>
          {children}
        </ResubHighlight>
      );
    case "gifted-sub":
      return (
        <GiftedSubHighlight platform={platform} style={style}>
          {children}
        </GiftedSubHighlight>
      );
    case "bits":
      return (
        <BitsHighlight platform={platform} style={style}>
          {children}
        </BitsHighlight>
      );
    case "cheer":
      return (
        <CheerHighlight platform={platform} style={style}>
          {children}
        </CheerHighlight>
      );
    case "highlighted-message":
      return (
        <HighlightedMessageHighlight platform={platform} style={style}>
          {children}
        </HighlightedMessageHighlight>
      );
    case "raid":
      return (
        <RaidHighlight platform={platform} style={style}>
          {children}
        </RaidHighlight>
      );
    case "ritual":
      return (
        <RitualHighlight platform={platform} style={style}>
          {children}
        </RitualHighlight>
      );
  }

  const exhaustive: never = kind;
  return exhaustive;
}

function EventSystemContent({
  currentChannelContext,
  message,
  renderEmotesAsText,
  viewerMentionUsername,
}: {
  currentChannelContext?: UsernameChannelContext;
  message: ChatMessageType;
  renderEmotesAsText: boolean;
  viewerMentionUsername?: string | null;
}) {
  const firstFragment = message.content[0];

  if (
    !firstFragment ||
    firstFragment.type !== "text" ||
    !message.highlightKind ||
    !USER_ATTRIBUTED_EVENT_KINDS.has(message.highlightKind)
  ) {
    return (
      <>
        {message.content.map((fragment, index) => (
          <MessageFragment
            key={fragmentKey(fragment, index)}
            fragment={fragment}
            platform={message.platform}
            renderEmotesAsText={renderEmotesAsText}
            viewerMentionUsername={viewerMentionUsername}
          />
        ))}
      </>
    );
  }

  const actionText = splitLeadingEventUsername(
    firstFragment.content,
    message.displayName,
    message.username
  );

  if (actionText === null) {
    return (
      <>
        {message.content.map((fragment, index) => (
          <MessageFragment
            key={fragmentKey(fragment, index)}
            fragment={fragment}
            platform={message.platform}
            renderEmotesAsText={renderEmotesAsText}
            viewerMentionUsername={viewerMentionUsername}
          />
        ))}
      </>
    );
  }

  const actionFragments = [
    { ...firstFragment, content: capitalizeEventAction(actionText) },
    ...message.content.slice(1),
  ].filter((fragment) => fragment.type !== "text" || fragment.content.length > 0);

  return (
    <span className="flex min-w-0 flex-col items-start">
      <Username
        userId={message.userId || message.username}
        username={message.username}
        displayName={message.displayName}
        color={message.color}
        platform={message.platform}
        className="align-baseline text-sm leading-[18px]"
        currentChannelContext={currentChannelContext}
        noWrap
      />
      {actionFragments.length > 0 && (
        <span className="min-w-0 break-words text-sm font-bold leading-[18px] text-white [overflow-wrap:anywhere]">
          {actionFragments.map((fragment, index) => (
            <MessageFragment
              key={fragmentKey(fragment, index)}
              fragment={fragment}
              platform={message.platform}
              renderEmotesAsText={renderEmotesAsText}
              viewerMentionUsername={viewerMentionUsername}
            />
          ))}
        </span>
      )}
    </span>
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
    badgeLimit,
    embedded = false,
  }) => {
    const cd = useAuthStore((s) => s.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
    const moderationHighlightStyle =
      cd.moderationHighlightStyle ?? DEFAULT_CHAT_DISPLAY_PREFERENCES.moderationHighlightStyle;
    const [isMessageRowHovered, setIsMessageRowHovered] = useState(false);
    const viewerMentionUsername = useAuthStore((s) => {
      if (message.platform === "twitch") {
        return s.twitchConnected ? s.twitchUser?.login : null;
      }

      return s.kickConnected ? (s.kickUser?.username ?? s.kickUser?.slug) : null;
    });
    // Density drives row padding + line-height; font size is applied inline so it
    // can be any px value from prefs (replacing the hardcoded `text-sm`).
    const densityClass =
      cd.density === "compact" ? "px-4 py-0 leading-[1.2]" : "px-4 py-1 leading-[22px]";
    const mentionDensityClass =
      cd.density === "compact" ? "py-0 leading-[1.2]" : "py-1 leading-[22px]";
    const fontSizeStyle = { fontSize: cd.fontSizePx };
    const isDeleted = message.isDeleted;
    const isOwnMessage = selfUserId !== undefined && message.userId === selfUserId;
    const isKickBroadcasterMessage = isKickChannelBroadcasterMessage(
      message,
      currentChannelContext
    );
    const displayBadges = useMemo(() => {
      if (!isKickBroadcasterMessage) return message.badges;
      return message.badges.filter((badge) => badge.setId !== "moderator");
    }, [isKickBroadcasterMessage, message.badges]);
    const renderableBadges = useMemo(() => {
      const orderedBadges = orderRenderableBadges(displayBadges, message.platform);
      return badgeLimit == null ? orderedBadges : orderedBadges.slice(0, badgeLimit);
    }, [badgeLimit, displayBadges, message.platform]);
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
      const {
        bannedUsername,
        bannedByUsername,
        bannedUser,
        bannedByUser,
        deletedMessageDetails,
        lastMessage,
        deletedMessages,
        duration,
      } = message.banInfo;
      const displayMode = deletedMessageDisplayMode(cd.deletedMessageDisplay);
      const actionText = duration
        ? `timed out for ${formatDuration(duration)}`
        : "permanently banned";
      const moderatorUsername = bannedByUsername?.trim() || "unknown moderator";
      const bannedUserBadges = orderRenderableBadges(bannedUser?.badges ?? [], message.platform);
      const moderatorUser =
        bannedByUser ??
        (bannedByUsername?.trim()
          ? {
              userId: bannedByUsername,
              username: bannedByUsername,
              displayName: bannedByUsername,
              badges: [],
            }
          : undefined);
      const moderatorBadges = orderRenderableBadges(moderatorUser?.badges ?? [], message.platform);
      const retainedDeletedMessages = deletedMessageDetails?.filter(
        (deletedMessage) =>
          deletedMessage.content.length > 0 || deletedMessage.rawContent.trim().length > 0
      );
      const fallbackDeletedMessages =
        deletedMessages && deletedMessages.length > 0
          ? deletedMessages
          : lastMessage
            ? [lastMessage]
            : [];
      const visibleDeletedMessages = fallbackDeletedMessages.filter((entry) => entry.trim());
      const canShowDeletedMessages = cd.showClearMsg && displayMode !== "tombstone";
      const moderationTimestamp = formatModerationTimestamp(message.timestamp, displayMode);
      const actionLabel: "Timeout" | "Ban" = duration ? "Timeout" : "Ban";
      const actionPhrase = `was ${actionText}`;
      const summary = (
        <div className="min-w-0 text-sm leading-[1.45]">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1 align-middle">
            {renderBadgeList(bannedUserBadges, message.platform)}
            <Username
              userId={bannedUser?.userId ?? bannedUsername}
              username={bannedUser?.username ?? bannedUsername}
              displayName={bannedUser?.displayName ?? bannedUsername}
              color={bannedUser?.color}
              platform={message.platform}
              className="align-middle"
              currentChannelContext={currentChannelContext}
              noWrap
            />
          </span>
          <span className="font-bold text-white"> {actionPhrase}</span>
          <span className="text-[#adadb8]"> by </span>
          {moderatorUser ? (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1 align-middle">
              {renderBadgeList(moderatorBadges, message.platform)}
              <Username
                userId={moderatorUser.userId}
                username={moderatorUser.username}
                displayName={moderatorUser.displayName}
                color={moderatorUser.color}
                platform={message.platform}
                className="align-middle"
                currentChannelContext={currentChannelContext}
                noWrap
              />
            </span>
          ) : (
            <span className="font-medium text-[#f4f4f5]">{moderatorUsername}</span>
          )}
          {moderationTimestamp && <span className="text-[#adadb8]"> at {moderationTimestamp}</span>}
        </div>
      );
      const deletedMessageCount = retainedDeletedMessages?.length ?? visibleDeletedMessages.length;
      const deletedMessageRows =
        canShowDeletedMessages && deletedMessageCount > 0 ? (
          <ol className="space-y-1">
            {retainedDeletedMessages && retainedDeletedMessages.length > 0
              ? retainedDeletedMessages.map((deletedMessage) => {
                  const authorBadges = orderRenderableBadges(
                    deletedMessage.author.badges,
                    message.platform
                  );
                  return (
                    <li
                      className="min-w-0 break-words align-bottom text-base font-normal leading-[22px] text-white [overflow-wrap:anywhere]"
                      key={deletedMessage.id}
                    >
                      <span className="inline-flex min-w-0 max-w-full items-end gap-1 align-bottom">
                        {renderBadgeList(authorBadges, message.platform)}
                        <Username
                          userId={deletedMessage.author.userId}
                          username={deletedMessage.author.username}
                          displayName={deletedMessage.author.displayName}
                          color={deletedMessage.author.color}
                          platform={message.platform}
                          className="align-bottom"
                          currentChannelContext={currentChannelContext}
                          keepSuffixAttached
                          suffix={<span className="align-bottom text-white">:</span>}
                        />
                      </span>
                      <span className="ml-1 inline align-bottom break-words text-white [overflow-wrap:anywhere] [&_img]:align-bottom">
                        {deletedMessage.content.length > 0
                          ? deletedMessage.content.map((fragment, index) => (
                              <MessageFragment
                                key={fragmentKey(fragment, index)}
                                fragment={fragment}
                                platform={message.platform}
                                viewerMentionUsername={viewerMentionUsername}
                              />
                            ))
                          : deletedMessage.rawContent}
                      </span>
                    </li>
                  );
                })
              : visibleDeletedMessages.map((deletedMessage) => (
                  <li
                    className="min-w-0 break-words align-bottom text-base font-normal leading-[22px] text-white [overflow-wrap:anywhere]"
                    key={deletedMessage}
                  >
                    <span className="inline-flex min-w-0 max-w-full items-end gap-1 align-bottom">
                      {renderBadgeList(bannedUserBadges, message.platform)}
                      <Username
                        userId={bannedUser?.userId ?? bannedUsername}
                        username={bannedUser?.username ?? bannedUsername}
                        displayName={bannedUser?.displayName ?? bannedUsername}
                        color={bannedUser?.color}
                        platform={message.platform}
                        className="align-bottom"
                        currentChannelContext={currentChannelContext}
                        keepSuffixAttached
                        suffix={<span className="align-bottom text-white">:</span>}
                      />
                    </span>
                    <span className="ml-1 inline align-bottom break-words text-white [overflow-wrap:anywhere]">
                      {deletedMessage}
                    </span>
                  </li>
                ))}
          </ol>
        ) : undefined;
      const sharedProps = {
        actionLabel,
        deletedMessageCount,
        deletedMessages: deletedMessageRows,
        style,
        summary,
      };

      return moderationHighlightStyle === "cozy" ? (
        <ModerationActionHighlightCozy {...sharedProps} />
      ) : (
        <ModerationActionHighlightCompact {...sharedProps} platform={message.platform} />
      );
    }

    if (isDeleted) {
      // U5 — the "Message deleted" tombstone is the single-message-deletion
      // notice. When the viewer has disabled it, drop the row entirely rather
      // than leaving a placeholder.
      if (!cd.showClearMsg) return null;
      const displayMode = deletedMessageDisplayMode(cd.deletedMessageDisplay);
      if (displayMode !== "tombstone" && hasRetainedDeletedContent(message)) {
        return (
          <DeletedMessageHighlight
            badges={renderableBadges}
            badgeLimit={badgeLimit}
            currentChannelContext={currentChannelContext}
            deletedAt={message.deletedAt ?? message.timestamp}
            highlightStyle={moderationHighlightStyle}
            message={message}
            mode={displayMode}
            moderatorUser={message.deletedByUser}
            moderatorUsername={message.deletedByUsername}
            usernamesInteractive={!embedded}
            style={style}
          >
            {message.content.map((fragment, index) => (
              <MessageFragment
                key={fragmentKey(fragment, index)}
                fragment={fragment}
                platform={message.platform}
                viewerMentionUsername={viewerMentionUsername}
              />
            ))}
          </DeletedMessageHighlight>
        );
      }
      return (
        <div className="px-4 py-1 text-sm text-foreground-muted italic opacity-50" style={style}>
          Message deleted
        </div>
      );
    }

    // U5 — first-time chatter chat rows now use Twitch's framed callout style.
    // System / connection / notice lines still use their existing inline
    // highlight and ignore the first-message preference.
    const eventHighlightKind = getEventHighlightKind(message);
    const showFirstTimeChatHighlight =
      (eventHighlightKind === "first-time-chat" && cd.firstMsgHighlight) ||
      (!eventHighlightKind &&
        message.isHighlighted &&
        message.type === "message" &&
        cd.firstMsgHighlight);
    const showModeratorHighlight =
      message.type === "message" && displayBadges.some((badge) => badge.setId === "moderator");
    const framedEventHighlightKind: Exclude<ChatHighlightKind, "first-time-chat"> | undefined =
      eventHighlightKind && eventHighlightKind !== "first-time-chat"
        ? eventHighlightKind
        : undefined;
    const showHighlight =
      message.isHighlighted && message.type !== "message" && !eventHighlightKind;
    const isFramedHighlight =
      mentionsViewer ||
      showFirstTimeChatHighlight ||
      showModeratorHighlight ||
      Boolean(framedEventHighlightKind);

    // U5 — when `systemMessageEmotes` is off, emotes inside system / notice
    // lines render as their literal name instead of an image. Regular chat
    // messages are unaffected.
    const renderEmotesAsText = message.type === "system" && !cd.systemMessageEmotes;
    const isMessage = message.type === "message";
    const senderIsProtected =
      isKickBroadcasterMessage || displayBadges.some((b) => PROTECTED_BADGE_SET_IDS.has(b.setId));
    const canShowMessageModActions = isMessage && (!senderIsProtected || isOwnMessage);
    const canReply = Boolean(onReply) && isMessage;
    const canPin = Boolean(onPin) && canShowMessageModActions;
    const showUserTargetingInlineActions = !isOwnMessage;
    const inlineBanAction = showUserTargetingInlineActions ? onBan : undefined;
    const inlineTimeoutAction = showUserTargetingInlineActions ? onTimeout : undefined;
    const inlineWarnAction = showUserTargetingInlineActions ? onWarn : undefined;
    const inlineUnbanAction = showUserTargetingInlineActions ? onUnban : undefined;
    const inlineDeleteAction = onDelete;
    const hasInlineModActions =
      canShowMessageModActions &&
      Boolean(
        inlineBanAction ||
          inlineTimeoutAction ||
          inlineWarnAction ||
          inlineUnbanAction ||
          inlineDeleteAction
      );
    const updateMessageRowHover = (target: EventTarget | null) => {
      const targetElement = target instanceof Element ? target : null;
      const isUsernameTarget = Boolean(targetElement?.closest(".chat-line__username-container"));
      setIsMessageRowHovered((current) => {
        const next = !isUsernameTarget;
        return current === next ? current : next;
      });
    };

    if (framedEventHighlightKind && message.type === "system") {
      return (
        <EventHighlight kind={framedEventHighlightKind} platform={message.platform} style={style}>
          <EventSystemContent
            currentChannelContext={currentChannelContext}
            message={message}
            renderEmotesAsText={renderEmotesAsText}
            viewerMentionUsername={viewerMentionUsername}
          />
        </EventHighlight>
      );
    }

    const messageRow = (
      <div
        className={`group relative min-w-0 max-w-full overflow-x-clip ${isFramedHighlight ? mentionDensityClass : densityClass} ${isMessageRowHovered ? "bg-[rgba(255,255,255,0.16)]" : ""} ${showHighlight ? "bg-purple-500/10 border-l border-purple-500" : ""} ${message.isHistorical ? "opacity-60" : ""}`}
        style={
          isFramedHighlight ? fontSizeStyle : style ? { ...style, ...fontSizeStyle } : fontSizeStyle
        }
        onMouseEnter={(event) => updateMessageRowHover(event.target)}
        onMouseMove={(event) => updateMessageRowHover(event.target)}
        onMouseLeave={() => setIsMessageRowHovered(false)}
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
              {inlineBanAction && (
                <IconActionTooltip label="Ban user">
                  <button
                    type="button"
                    onClick={() => inlineBanAction(message)}
                    className={INLINE_MOD_BUTTON_CLASS}
                    aria-label="Ban user"
                  >
                    <Ban className="h-4 w-4" strokeWidth={2.75} />
                  </button>
                </IconActionTooltip>
              )}
              {inlineTimeoutAction && (
                <IconActionTooltip label="Timeout user">
                  <button
                    type="button"
                    onClick={() => inlineTimeoutAction(message)}
                    className={INLINE_MOD_BUTTON_CLASS}
                    aria-label="Timeout user"
                  >
                    <Clock3 className="h-4 w-4" strokeWidth={2.75} />
                  </button>
                </IconActionTooltip>
              )}
              {inlineWarnAction && (
                <IconActionTooltip label="Warn user">
                  <button
                    type="button"
                    onClick={() => inlineWarnAction(message)}
                    className={INLINE_MOD_BUTTON_CLASS}
                    aria-label="Warn user"
                  >
                    <TriangleAlert className="h-4 w-4" strokeWidth={2.75} />
                  </button>
                </IconActionTooltip>
              )}
              {inlineUnbanAction && (
                <IconActionTooltip label="Unban user">
                  <button
                    type="button"
                    onClick={() => inlineUnbanAction(message)}
                    className={INLINE_MOD_BUTTON_CLASS}
                    aria-label="Unban user"
                  >
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </button>
                </IconActionTooltip>
              )}
              {inlineDeleteAction && (
                <IconActionTooltip label="Delete message">
                  <button
                    type="button"
                    onClick={() => inlineDeleteAction(message)}
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
              avatarUrl={message.avatarUrl}
              color={message.color}
              platform={message.platform}
              className="align-middle"
              currentChannelContext={currentChannelContext}
              interactive={!embedded}
              openingMessage={message}
              suffix={!message.isAction ? <span className="mr-1 align-middle">:</span> : undefined}
            />
          </span>

          {/* Content */}
          <span
            className={`align-middle min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${message.isAction ? "ml-1 italic" : ""}`}
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

        {(canPin || canReply) && (
          <span
            className={TWITCH_MESSAGE_ACTION_CLUSTER_CLASS}
            data-testid="chat-message-hover-actions"
          >
            {canPin && <ChatPinButton onClick={() => onPin?.(message)} />}
            {canReply && <ChatReplyButton onClick={() => onReply?.(message)} />}
          </span>
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

    if (framedEventHighlightKind) {
      return (
        <EventHighlight
          kind={framedEventHighlightKind}
          platform={message.platform}
          style={style ? { ...style, ...fontSizeStyle } : fontSizeStyle}
        >
          {messageRow}
        </EventHighlight>
      );
    }

    if (showModeratorHighlight) {
      return (
        <ModeratorHighlight
          platform={message.platform}
          style={style ? { ...style, ...fontSizeStyle } : fontSizeStyle}
        >
          {messageRow}
        </ModeratorHighlight>
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
