/**
 * Shared pinned-message banner used by both Twitch and Kick chats.
 *
 * Visual style mirrors Twitch.tv's native pinned card: an inset 6px-radius
 * card with a "Pinned by [mod]" label on top and the original message row
 * underneath. Layout is narrow-width safe down to ~280px (multistream slot
 * floor); long content truncates to one line in collapsed state and wraps
 * in expanded state.
 *
 * The close control is viewer-role-aware:
 *   - viewerRole="viewer" -> Dismiss (X icon), local-only via `onDismiss`
 *   - viewerRole="mod"    -> Unpin (eye-off icon), server-side via `onUnpin`
 */

import type React from "react";
import { memo, useMemo } from "react";
import { BsChevronDown, BsReplyFill } from "react-icons/bs";
import type {
  ChatBadge as ChatBadgeType,
  ContentFragment,
  NormalizedPinnedMessage,
} from "../../shared/chat-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ChatBadge } from "./ChatBadge";
import { ChatEmote } from "./ChatEmote";
import { formatMentionLabel } from "./mention-label";
import { Username, type UsernameChannelContext } from "./Username";

/**
 * Inline pin SVG — verbatim path from Twitch's own .pinned-chat__highlight-card
 * (captured 2026-05-18). Rendered at 16x16 to match Twitch's computed icon
 * size alongside the 14px "Pinned by" label.
 */
const PinIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    className={className}
    fill="currentColor"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18 4V2H6v2h2v5a3 3 0 0 0-3 3v4h14v-4a3 3 0 0 0-3-3V4h2Zm-1 10H7v-2a1 1 0 0 1 1-1h2V4h4v7h2a1 1 0 0 1 1 1v2Z"
    />
    <path d="M13 18h-2v4h2v-4Z" />
  </svg>
);

/**
 * Inline eye-off SVG — verbatim from Twitch's "Hide for yourself" button on
 * the expanded pin card (captured 2026-05-18 from twitch.tv/summit1g). The
 * SVG is rendered at 20×20 to match Twitch's computed icon size inside its
 * 32×32 ScButtonIcon container.
 */
const EyeOffIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    className={className}
    fill="currentColor"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="m2.293 3.707 18 18 1.414-1.414-3.683-3.683a7.98 7.98 0 0 0 .37-.404L22 12l-3.605-4.206A8 8 0 0 0 12.32 5h-.64a8 8 0 0 0-4.122 1.144l-3.85-3.851-1.415 1.414Zm6.738 3.91 2.45 2.45a2.003 2.003 0 0 1 2.451 2.451l2.678 2.678c.091-.094.18-.191.266-.291L19.366 12l-2.49-2.905A6 6 0 0 0 12.32 7h-.64a6 6 0 0 0-2.65.616Z"
    />
    <path d="M12.32 19c.74 0 1.469-.102 2.167-.299l-1.718-1.718a5.967 5.967 0 0 1-.449.017h-.64a6 6 0 0 1-4.556-2.095L4.634 12l1.455-1.697L4.67 8.885 2 12l3.605 4.206A8 8 0 0 0 11.68 19h.64Z" />
  </svg>
);

/**
 * Tailwind classes for Twitch's standard 32×32 round icon button. Matches
 * twitch.tv's `ScButtonIcon-sc-9yap0r-0` shape: 32×32, fully rounded,
 * transparent bg, light tinted hover. Shared by Expand/Collapse and Hide
 * so the two controls have identical hit areas and visuals.
 */
const ICON_BUTTON_CLASS =
  "inline-flex items-center justify-center w-8 h-8 rounded-full text-[#EFEFF1] " +
  "hover:bg-white/10 active:bg-white/15 transition-colors";

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

function orderRenderableUsernameBadges(
  badges: ReadonlyArray<ChatBadgeType>,
  platform: NormalizedPinnedMessage["platform"]
): ChatBadgeType[] {
  const renderableBadges = badges.filter((badge) => badge.imageUrl);
  if (platform !== "kick") return renderableBadges;

  return renderableBadges.toSorted((a, b) => {
    if (isKickGiftBadge(a.setId) && b.setId === "subscriber") return -1;
    if (a.setId === "subscriber" && isKickGiftBadge(b.setId)) return 1;
    return 0;
  });
}

/** Format an ISO timestamp as "HH:MM AM/PM" — same shape Twitch uses in the
 *  sender-attribution row of expanded pinned messages. */
function formatSentAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export interface PinnedMessageBannerProps {
  pin: NormalizedPinnedMessage;
  /** Determines which close control is rendered. */
  viewerRole: "mod" | "viewer";
  isExpanded: boolean;
  onExpandToggle: () => void;
  /** Viewer-only local dismiss. */
  onDismiss?: () => void;
  /** Mod-only server-side unpin. */
  onUnpin?: () => void;
  /** Optional reply-to-pinned-author action. Only rendered when expanded. */
  onReply?: () => void;
  /** Channel scope used by clickable usernames to open the user popout. */
  currentChannelContext?: UsernameChannelContext;
}

const PinnedFragment: React.FC<{ fragment: ContentFragment; platform: "twitch" | "kick" }> = memo(
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
            isZeroWidth={fragment.isZeroWidth}
          />
        );
      case "mention":
        return (
          <span className="bg-white/10 font-bold px-1 rounded mx-0.5 text-white">
            {formatMentionLabel(fragment.username)}
          </span>
        );
      case "link":
        return (
          <a
            href={fragment.url}
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI?.openExternal?.(fragment.url);
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
PinnedFragment.displayName = "PinnedFragment";

export const PinnedMessageBanner: React.FC<PinnedMessageBannerProps> = ({
  pin,
  viewerRole,
  isExpanded,
  onExpandToggle,
  onDismiss,
  onUnpin,
  onReply,
  currentChannelContext,
}) => {
  const renderableAuthorBadges = useMemo(
    () => orderRenderableUsernameBadges(pin.author.badges, pin.platform),
    [pin.author.badges, pin.platform]
  );
  const renderablePinnedByBadges = useMemo(
    () => orderRenderableUsernameBadges(pin.pinnedBy?.badges ?? [], pin.platform),
    [pin.pinnedBy?.badges, pin.platform]
  );

  const accentColor = pin.author.color || (pin.platform === "kick" ? "#53FC18" : "#9146FF");
  const pinnedByColor = pin.pinnedBy?.color || accentColor;
  const cardStyle =
    pin.platform === "kick"
      ? {
          borderColor: "rgba(240, 241, 242, 0.16)",
        }
      : undefined;

  return (
    <div
      data-testid="pinned-message-banner"
      data-role={viewerRole}
      data-platform={pin.platform}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 px-2 pt-2 pb-1"
    >
      {/* Sizes / colors / line-heights mirror Twitch's native .highlight card:
       *   inner card 1px solid rgba(83,83,95,0.48), 6px radius, 8px padding
       *   "Pinned by" label: 14px / 400 / 1.4
       *   message body:      18px / 500 / 1.3
       * Captured live from twitch.tv/fitzbro on 2026-05-18.
       */}
      <div
        className="pointer-events-auto border border-[var(--color-border,rgba(83,83,95,0.48))] rounded-md bg-neutral-800 p-2"
        style={cardStyle}
      >
        {/* Header row: pin icon + "Pinned by [badges] X" + controls.
         * Mirrors Twitch's native layout: 16px pin SVG, then a 14px label
         * that includes any inline badges (e.g. Broadcaster) sandwiched
         * between "Pinned by " and the colored username. */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            <PinIcon className="flex-shrink-0 text-[#EFEFF1]" />
            {pin.pinnedBy ? (
              // Twitch renders this as inline text with the badge as an
              // inline-block child carrying `margin: 0 3px 1.5px 0` —
              // 3px after the badge (badge-to-username gap), 1.5px below
              // (lifts it above the text baseline). We mirror that with
              // explicit gap-[3px] + a custom translate so flex doesn't
              // center the badge perfectly on the cap height.
              <div
                // [&_img]:!mr-0 strips ChatBadge's baked-in `mr-1` (4px) so
                // our flex `gap: 3px` is the only thing controlling spacing
                // — matching Twitch's 3px badge-margin-right exactly.
                // min-w-0 lets this flex item shrink below its content width
                // so the username span's `truncate` can fire when long.
                className="text-sm text-[#EFEFF1] leading-snug flex items-center min-w-0 [&_img]:!mr-0"
                style={{ gap: "3px" }}
                data-testid="pinned-message-header"
              >
                <span className="flex-shrink-0">Pinned by</span>
                {renderablePinnedByBadges.map((badge, i) => (
                  <span
                    key={`${badge.setId}-${badge.version}-${i}`}
                    className="inline-flex flex-shrink-0"
                    style={{ marginBottom: "1.5px" }}
                  >
                    <ChatBadge badge={badge} platform={pin.platform} />
                  </span>
                ))}
                <Username
                  userId={pin.pinnedBy.userId ?? pin.pinnedBy.username}
                  username={pin.pinnedBy.username}
                  displayName={pin.pinnedBy.username}
                  color={pinnedByColor}
                  platform={pin.platform}
                  className="font-semibold truncate min-w-0"
                  currentChannelContext={currentChannelContext}
                />
              </div>
            ) : (
              <div className="text-sm text-[#EFEFF1] truncate leading-snug">Pinned message</div>
            )}
          </div>
          {/* Control order matches twitch.tv's expanded card layout:
           *   [Hide (eye-off)] [Collapse chevron]
           * Hide is only rendered when expanded; Twitch's collapsed state has
           * only the Expand chevron. Mod role replaces Hide with Unpin. */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {viewerRole === "viewer" && isExpanded && onDismiss ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onDismiss}
                    className={ICON_BUTTON_CLASS}
                    aria-label="Hide for yourself"
                  >
                    <EyeOffIcon />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Hide for yourself</TooltipContent>
              </Tooltip>
            ) : null}
            {viewerRole === "mod" && onUnpin ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onUnpin}
                    className={ICON_BUTTON_CLASS}
                    aria-label="Unpin"
                    data-testid="pinned-message-unpin-button"
                  >
                    <EyeOffIcon />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Unpin</TooltipContent>
              </Tooltip>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onExpandToggle}
                  className={ICON_BUTTON_CLASS}
                  aria-label={isExpanded ? "Collapse pinned message" : "Expand pinned message"}
                >
                  <BsChevronDown
                    size={20}
                    style={{
                      transform: isExpanded ? "rotate(180deg)" : "none",
                      transition: "transform 0.2s",
                    }}
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>{isExpanded ? "Collapse" : "Expand"}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Message body: just the content. Twitch's native card omits the
         * sender entirely in collapsed state — the "Pinned by X" header is
         * the only attribution. 18px / weight 500 / 1.3 line-height.
         *
         * Body always wraps (twitch.tv parity): long messages flow to as many
         * lines as needed; long URLs fall back to `break-all` on the link
         * fragment itself. The expand/collapse chevron only toggles the
         * sender row + reply button — never clips the message. */}
        <div
          className="mt-0.5 text-lg font-medium leading-snug text-[#EFEFF1] break-words"
          data-testid="pinned-message-content"
        >
          {pin.content.map((fragment, i) => (
            <PinnedFragment
              key={`${fragment.type}-${i}`}
              fragment={fragment}
              platform={pin.platform}
            />
          ))}
        </div>

        {/* Bottom attribution row (expanded only). One inline row matching
         * the format from the reference screenshot:
         *   [author badges] username sent at HH:MM PM
         * Same 14px text-sm size as the "Pinned by" header so the visual
         * weight is consistent. Badge spacing mirrors Twitch's: 3px between
         * each element, with each badge lifted 1.5px above baseline so it
         * aligns with the text x-height the way twitch.tv does. */}
        {isExpanded && pin.author.username && pin.author.username !== "unknown" ? (
          <div
            // Same `[&_img]:!mr-0` reset as the header — strips ChatBadge's
            // baked-in mr-1 so our flex gap is the only spacing.
            className="mt-2 flex items-center text-sm text-[#EFEFF1] flex-wrap leading-snug [&_img]:!mr-0"
            style={{ gap: "3px" }}
            data-testid="pinned-message-sender-row"
          >
            {renderableAuthorBadges.map((badge, i) => (
              <span
                key={`${badge.setId}-${badge.version}-${i}`}
                className="inline-flex"
                style={{ marginBottom: "1.5px" }}
              >
                <ChatBadge badge={badge} platform={pin.platform} />
              </span>
            ))}
            <Username
              userId={pin.author.userId ?? pin.author.username}
              username={pin.author.username}
              displayName={pin.author.displayName || pin.author.username}
              color={accentColor}
              platform={pin.platform}
              className="font-semibold"
              currentChannelContext={currentChannelContext}
            />
            {pin.sentAt ? (
              <span className="text-[#E6E6E6]" data-testid="pinned-message-timestamp">
                sent at {formatSentAt(pin.sentAt)}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Expanded-only actions row */}
        {isExpanded && onReply ? (
          <div className="mt-1 flex justify-end">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onReply}
                  className="flex items-center gap-1 text-xs text-neutral-400 hover:text-white px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
                  aria-label="Reply to pinned message"
                >
                  <BsReplyFill size={10} />
                  Reply
                </button>
              </TooltipTrigger>
              <TooltipContent>Reply to pinned message</TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </div>
    </div>
  );
};

PinnedMessageBanner.displayName = "PinnedMessageBanner";
