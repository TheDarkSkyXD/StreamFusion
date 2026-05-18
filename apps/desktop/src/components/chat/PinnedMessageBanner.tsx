/**
 * Shared pinned-message banner used by both Twitch and Kick chats.
 *
 * Visual style mirrors Twitch.tv's native pinned card: an inset 6px-radius
 * card with a "Pinned by [mod]" label on top and the original message row
 * underneath. Layout is narrow-width safe down to ~280px (multistream slot
 * floor); long content truncates to one line in collapsed state and wraps
 * in expanded state.
 *
 * The close control is role-aware:
 *   - role="viewer" -> Dismiss (X icon), local-only via `onDismiss`
 *   - role="mod"    -> Unpin (text button), two-step confirm via `onUnpin`
 *
 * The confirm step swaps the button label to "Confirm unpin" for 5 seconds
 * after the first click; a second click within the window fires `onUnpin`,
 * otherwise the button auto-reverts.
 */

import type React from "react";
import { memo, useEffect, useRef, useState } from "react";
import { BsChevronDown, BsReplyFill } from "react-icons/bs";
import type { ContentFragment, NormalizedPinnedMessage } from "../../shared/chat-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { ChatBadge } from "./ChatBadge";
import { ChatEmote } from "./ChatEmote";

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

/**
 * Twitch's own pin card shows just ONE badge between "Pinned by" and the
 * username — the user's highest-priority role badge. Pick that one badge
 * out of the displayBadges list using a fixed priority. Returns null if
 * none of the priority sets match (we then render no badge).
 */
const PRIMARY_BADGE_PRIORITY = [
  "broadcaster",
  "moderator",
  "staff",
  "admin",
  "global_mod",
  "vip",
  "founder",
  "premium",
  "partner",
  "verified",
  "subscriber",
] as const;

function pickPrimaryBadge(
  badges: ReadonlyArray<{ setId: string }> | undefined,
): { setId: string } | null {
  if (!badges || badges.length === 0) return null;
  for (const set of PRIMARY_BADGE_PRIORITY) {
    const b = badges.find((x) => x.setId === set);
    if (b) return b;
  }
  // No match in the priority list — fall back to the first available badge
  // rather than rendering nothing (better signal than empty).
  return badges[0] ?? null;
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

const UNPIN_CONFIRM_WINDOW_MS = 5000;

export interface PinnedMessageBannerProps {
  pin: NormalizedPinnedMessage;
  /** Determines which close control is rendered. */
  role: "mod" | "viewer";
  isExpanded: boolean;
  onExpandToggle: () => void;
  /** Viewer-only local dismiss. */
  onDismiss?: () => void;
  /** Mod-only server-side unpin (called after the confirm step). */
  onUnpin?: () => void;
  /** Optional reply-to-pinned-author action. Only rendered when expanded. */
  onReply?: () => void;
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
  },
);
PinnedFragment.displayName = "PinnedFragment";

export const PinnedMessageBanner: React.FC<PinnedMessageBannerProps> = ({
  pin,
  role,
  isExpanded,
  onExpandToggle,
  onDismiss,
  onUnpin,
  onReply,
}) => {
  const [unpinArmed, setUnpinArmed] = useState(false);
  const armTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!unpinArmed) return;
    armTimeoutRef.current = setTimeout(() => setUnpinArmed(false), UNPIN_CONFIRM_WINDOW_MS);
    return () => {
      if (armTimeoutRef.current) clearTimeout(armTimeoutRef.current);
    };
  }, [unpinArmed]);

  // Reset confirm-armed state whenever the pin itself changes (new pin
  // arriving in place of the old one should never inherit a half-confirmed
  // unpin state).
  useEffect(() => {
    setUnpinArmed(false);
  }, [pin.messageId]);

  const handleUnpinClick = () => {
    if (!onUnpin) return;
    if (unpinArmed) {
      setUnpinArmed(false);
      onUnpin();
    } else {
      setUnpinArmed(true);
    }
  };

  const accentColor = pin.author.color || (pin.platform === "kick" ? "#53FC18" : "#9146FF");
  const pinnedByColor = pin.pinnedBy?.color || accentColor;

  return (
    <div
      data-testid="pinned-message-banner"
      data-role={role}
      data-platform={pin.platform}
      className="px-2 pt-2 pb-1"
    >
      {/* Sizes / colors / line-heights mirror Twitch's native .highlight card:
       *   inner card 1px solid rgba(83,83,95,0.48), 6px radius, 8px padding
       *   "Pinned by" label: 14px / 400 / 1.4
       *   message body:      18px / 500 / 1.3
       * Captured live from twitch.tv/fitzbro on 2026-05-18.
       */}
      <div className="border border-[var(--color-border,rgba(83,83,95,0.48))] rounded-md bg-transparent p-2">
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
                className="text-sm text-[#EFEFF1] truncate leading-snug flex items-center [&_img]:!mr-0"
                style={{ gap: "3px" }}
                data-testid="pinned-message-header"
              >
                <span>Pinned by</span>
                {(() => {
                  // Twitch shows just ONE badge next to the pinner's username
                  // in the header — the user's highest-priority role badge.
                  const primary = pickPrimaryBadge(pin.pinnedBy.badges);
                  if (!primary) return null;
                  const fullBadge = pin.pinnedBy.badges.find(
                    (b) => b.setId === primary.setId,
                  );
                  return fullBadge ? (
                    <span className="inline-flex" style={{ marginBottom: "1.5px" }}>
                      <ChatBadge badge={fullBadge} platform={pin.platform} />
                    </span>
                  ) : null;
                })()}
                <span className="font-semibold" style={{ color: pinnedByColor }}>
                  {pin.pinnedBy.username}
                </span>
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
            {role === "viewer" && isExpanded && onDismiss ? (
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
            {role === "mod" && onUnpin ? (
              <button
                type="button"
                onClick={handleUnpinClick}
                className={`px-2 h-8 inline-flex items-center text-xs rounded-full transition-colors ${
                  unpinArmed
                    ? "bg-red-600 text-white hover:bg-red-500"
                    : "text-[#EFEFF1] hover:bg-white/10"
                }`}
                title={unpinArmed ? "Click again to confirm unpin" : "Unpin"}
                aria-label={unpinArmed ? "Confirm unpin" : "Unpin"}
              >
                {unpinArmed ? "Confirm unpin" : "Unpin"}
              </button>
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
         * the only attribution. 18px / weight 500 / 1.3 line-height. */}
        <div
          className={`mt-0.5 text-lg font-medium leading-snug text-[#EFEFF1] ${
            isExpanded ? "break-words" : "truncate"
          }`}
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
            {pin.author.badges.map((badge, i) => (
              <span
                key={`${badge.setId}-${badge.version}-${i}`}
                className="inline-flex"
                style={{ marginBottom: "1.5px" }}
              >
                <ChatBadge badge={badge} platform={pin.platform} />
              </span>
            ))}
            <span className="font-semibold" style={{ color: accentColor }}>
              {pin.author.username}
            </span>
            {pin.sentAt ? (
              <span className="text-gray-400" data-testid="pinned-message-timestamp">
                sent at {formatSentAt(pin.sentAt)}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Expanded-only actions row */}
        {isExpanded && onReply ? (
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={onReply}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2 py-0.5 rounded hover:bg-white/10 transition-colors"
              title="Reply to pinned message"
              aria-label="Reply to pinned message"
            >
              <BsReplyFill size={10} />
              Reply
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

PinnedMessageBanner.displayName = "PinnedMessageBanner";
