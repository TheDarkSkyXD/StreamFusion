import { i18n } from "@/i18n";
/**
 * Shared pinned-message banner used by both Twitch and Kick chats.
 *
 * Visual style mirrors Twitch.tv's native pinned card: an inset 6px-radius
 * card with a "Pinned by [mod]" label on top and the original message row
 * underneath. Layout is narrow-width safe down to ~280px (multistream slot
 * floor); long content shows a short preview in collapsed state and wraps in
 * full when expanded.
 *
 * The close control is viewer-role-aware:
 *   - viewerRole="viewer" -> Dismiss (X icon), local-only via `onDismiss`
 *   - viewerRole="mod"    -> Unpin (eye-off icon), server-side via `onUnpin`
 */

import { MoreVertical } from "lucide-react";
import type React from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { BsChevronDown } from "react-icons/bs";
import { useInterval } from "@/hooks/useInterval";
import type {
  ChatBadge as ChatBadgeType,
  ContentFragment,
  NormalizedPinnedMessage,
} from "../../../../../shared/chat-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { ChatBadge } from "./ChatBadge";
import { ChatEmote } from "./ChatEmote";
import {
  TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS,
  TWITCH_CHAT_ACTION_TOOLTIP_CLASS,
} from "./ChatMessageActionStyles";
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
const COLLAPSED_CONTENT_STYLE: React.CSSProperties = {
  maxHeight: "3.25rem",
  WebkitMaskImage: "linear-gradient(to bottom, #000 72%, transparent)",
  maskImage: "linear-gradient(to bottom, #000 72%, transparent)",
};
const EXPANDED_SCROLL_AREA_STYLE: React.CSSProperties = {
  maxHeight: "200px",
  marginInlineEnd: "-10px",
  overflowX: "hidden",
  overflowY: "scroll",
  position: "relative",
};
const TWITCH_PIN_DURATION_OPTIONS = [
  { label: i18n.t("chat.1Minute"), value: 60 },
  { label: i18n.t("chat.5Minutes"), value: 5 * 60 },
  { label: i18n.t("chat.15Minutes"), value: 15 * 60 },
  { label: i18n.t("chat.30Minutes"), value: 30 * 60 },
  { label: i18n.t("chat.noExpiry"), value: null },
] as const;
const DEFAULT_TWITCH_PIN_DURATION_SECONDS = 30 * 60;
const CUSTOM_TWITCH_PIN_DURATION = "custom";

type TwitchPinDurationSelection =
  (typeof TWITCH_PIN_DURATION_OPTIONS)[number]["value"] | typeof CUSTOM_TWITCH_PIN_DURATION;
type TwitchPinDurationUnit = "seconds" | "minutes";

interface TwitchPinProgressState {
  percent: number;
  timeLeftLabel: string;
}

function formatTimeLeft(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  if (totalSeconds === 0) return "Expired";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s left`;
  if (minutes > 0) return `${minutes}m ${seconds}s left`;
  return `${seconds}s left`;
}

function getTwitchPinProgressState(
  pin: NormalizedPinnedMessage,
  now = Date.now()
): TwitchPinProgressState | null {
  if (pin.platform !== "twitch" || !pin.pinnedAt || !pin.expiresAt) return null;
  const start = Date.parse(pin.pinnedAt);
  const end = Date.parse(pin.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return {
    percent: Math.min(100, Math.max(0, ((end - now) / (end - start)) * 100)),
    timeLeftLabel: formatTimeLeft(end - now),
  };
}

function useTwitchPinProgressState(pin: NormalizedPinnedMessage): TwitchPinProgressState | null {
  const [now, setNow] = useState(() => Date.now());
  const { platform, pinnedAt, expiresAt } = pin;
  const hasRunningTimer =
    platform === "twitch" &&
    Boolean(pinnedAt && expiresAt) &&
    Number.isFinite(Date.parse(pinnedAt ?? "")) &&
    Number.isFinite(Date.parse(expiresAt ?? "")) &&
    Date.parse(expiresAt ?? "") > Date.parse(pinnedAt ?? "");

  useEffect(() => {
    if (platform !== "twitch" || !pinnedAt || !expiresAt) return;
    const start = Date.parse(pinnedAt);
    const end = Date.parse(expiresAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    setNow(Date.now());
  }, [platform, pinnedAt, expiresAt]);

  useInterval(() => setNow(Date.now()), hasRunningTimer ? 250 : null);

  return getTwitchPinProgressState(pin, now);
}

function getTwitchPinDurationSeconds(pin: NormalizedPinnedMessage): number | null {
  if (pin.platform !== "twitch" || !pin.pinnedAt || !pin.expiresAt) return null;
  const start = Date.parse(pin.pinnedAt);
  const end = Date.parse(pin.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  return Math.round((end - start) / 1000);
}

function getInitialTwitchPinDuration(pin: NormalizedPinnedMessage): TwitchPinDurationSelection {
  const seconds = getTwitchPinDurationSeconds(pin);
  if (seconds === null) return DEFAULT_TWITCH_PIN_DURATION_SECONDS;
  return TWITCH_PIN_DURATION_OPTIONS.some((opt) => opt.value === seconds)
    ? seconds
    : CUSTOM_TWITCH_PIN_DURATION;
}

function getInitialCustomDuration(pin: NormalizedPinnedMessage): {
  amount: string;
  unit: TwitchPinDurationUnit;
} {
  const seconds = getTwitchPinDurationSeconds(pin);
  if (seconds === null || TWITCH_PIN_DURATION_OPTIONS.some((opt) => opt.value === seconds)) {
    return { amount: "1", unit: "minutes" };
  }

  return seconds % 60 === 0
    ? { amount: String(seconds / 60), unit: "minutes" }
    : { amount: String(seconds), unit: "seconds" };
}

function resolveTwitchPinDurationSelection(
  selection: TwitchPinDurationSelection,
  customAmount: string,
  customUnit: TwitchPinDurationUnit
): number | null | undefined {
  if (selection !== CUSTOM_TWITCH_PIN_DURATION) return selection;
  const amount = Number(customAmount);
  if (!Number.isInteger(amount) || amount <= 0) return undefined;
  return customUnit === "minutes" ? amount * 60 : amount;
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
  /** Twitch mod-only duration update for the currently pinned message. */
  onUpdateDuration?: (durationSeconds: number | null) => void | Promise<void>;
  pinActionBusy?: boolean;
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
  onUpdateDuration,
  pinActionBusy = false,
  currentChannelContext,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<TwitchPinDurationSelection>(() =>
    getInitialTwitchPinDuration(pin)
  );
  const [customDurationAmount, setCustomDurationAmount] = useState(
    () => getInitialCustomDuration(pin).amount
  );
  const [customDurationUnit, setCustomDurationUnit] = useState<TwitchPinDurationUnit>(
    () => getInitialCustomDuration(pin).unit
  );
  const renderableAuthorBadges = useMemo(
    () => orderRenderableUsernameBadges(pin.author.badges, pin.platform),
    [pin.author.badges, pin.platform]
  );
  const renderablePinnedByBadges = useMemo(
    () => orderRenderableUsernameBadges(pin.pinnedBy?.badges ?? [], pin.platform),
    [pin.pinnedBy?.badges, pin.platform]
  );
  const progressState = useTwitchPinProgressState(pin);
  const progressWidth = progressState === null ? null : `${progressState.percent}%`;
  const progressAriaValue = progressState === null ? undefined : Math.round(progressState.percent);
  const showTwitchModMenu =
    pin.platform === "twitch" && viewerRole === "mod" && (!!onUnpin || !!onUpdateDuration);

  const accentColor = pin.author.color || (pin.platform === "kick" ? "#53FC18" : "#9146FF");
  const pinnedByColor = pin.pinnedBy?.color || accentColor;
  const pinnedByDisplayName = pin.pinnedBy?.displayName || pin.pinnedBy?.username || "";
  const shouldClipPinnedByUsername = pinnedByDisplayName.length > 20;
  const cardStyle =
    pin.platform === "kick"
      ? {
          borderColor: "rgba(240, 241, 242, 0.16)",
        }
      : undefined;

  useEffect(() => {
    setSelectedDuration(getInitialTwitchPinDuration(pin));
    const customDuration = getInitialCustomDuration(pin);
    setCustomDurationAmount(customDuration.amount);
    setCustomDurationUnit(customDuration.unit);
  }, [pin]);

  useEffect(() => {
    if (!isMenuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setIsMenuOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsMenuOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMenuOpen]);

  const handleApplyDuration = () => {
    if (!onUpdateDuration) return;
    const duration = resolveTwitchPinDurationSelection(
      selectedDuration,
      customDurationAmount,
      customDurationUnit
    );
    if (duration === undefined) return;
    setIsMenuOpen(false);
    void Promise.resolve(onUpdateDuration(duration));
  };
  const canApplyDuration =
    resolveTwitchPinDurationSelection(
      selectedDuration,
      customDurationAmount,
      customDurationUnit
    ) !== undefined;

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
        className="pointer-events-auto cursor-pointer border border-[var(--color-border,rgba(83,83,95,0.48))] rounded-md bg-neutral-800 p-2"
        style={cardStyle}
      >
        <div
          className="pinned-message-scrollbar relative"
          data-testid="pinned-message-scroll-area"
          data-expanded={isExpanded ? "true" : "false"}
          style={isExpanded ? EXPANDED_SCROLL_AREA_STYLE : undefined}
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
                  <span className="flex-shrink-0">{i18n.t("chat.pinnedBy")}</span>
                  {renderablePinnedByBadges.map((badge, i) => (
                    <span
                      key={`${badge.setId}-${badge.version}-${i}`}
                      className="inline-flex flex-shrink-0"
                      style={{ marginBottom: "1.5px" }}
                    >
                      <ChatBadge badge={badge} platform={pin.platform} />
                    </span>
                  ))}
                  <span
                    className={`min-w-0 ${shouldClipPinnedByUsername ? "overflow-hidden" : ""}`}
                    data-testid="pinned-message-header-username"
                  >
                    <Username
                      userId={pin.pinnedBy.userId ?? pin.pinnedBy.username}
                      username={pin.pinnedBy.username}
                      displayName={pinnedByDisplayName}
                      color={pinnedByColor}
                      platform={pin.platform}
                      className={`font-semibold ${
                        shouldClipPinnedByUsername ? "block max-w-full truncate" : ""
                      }`}
                      currentChannelContext={currentChannelContext}
                      noWrap
                    />
                  </span>
                </div>
              ) : (
                <div className="text-sm text-[#EFEFF1] truncate leading-snug">
                  {i18n.t("chat.pinnedMessage")}
                </div>
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
                      aria-label={i18n.t("chat.hideForYourself")}
                    >
                      <EyeOffIcon />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    className={TWITCH_CHAT_ACTION_TOOLTIP_CLASS}
                    arrowClassName={TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS}
                  >
                    {i18n.t("chat.hideForYourself")}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              {viewerRole === "mod" && onUnpin && !showTwitchModMenu ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={onUnpin}
                      className={ICON_BUTTON_CLASS}
                      aria-label={i18n.t("chat.unpin")}
                      data-testid="pinned-message-unpin-button"
                    >
                      <EyeOffIcon />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    className={TWITCH_CHAT_ACTION_TOOLTIP_CLASS}
                    arrowClassName={TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS}
                  >
                    {i18n.t("chat.unpin")}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              {showTwitchModMenu ? (
                <div ref={menuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setIsMenuOpen((open) => !open)}
                    className={ICON_BUTTON_CLASS}
                    aria-label={i18n.t("chat.pinnedMessageOptions")}
                    aria-expanded={isMenuOpen}
                    data-testid="pinned-message-options-button"
                  >
                    <MoreVertical size={20} strokeWidth={2.5} />
                  </button>
                  {isMenuOpen ? (
                    <div
                      role="menu"
                      aria-label={i18n.t("chat.pinnedMessageOptions")}
                      className="absolute right-0 top-full z-50 mt-1 w-56 rounded-md border border-[rgba(83,83,95,0.72)] bg-[#18181b] py-2 text-sm text-[#EFEFF1] shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
                      data-testid="pinned-message-options-menu"
                    >
                      {onUpdateDuration ? (
                        <div className="px-2">
                          <div className="px-2 pb-1 text-xs font-semibold uppercase text-[#adadb8]">
                            {i18n.t("chat.duration")}
                          </div>
                          <fieldset className="space-y-0.5">
                            {TWITCH_PIN_DURATION_OPTIONS.map((option) => (
                              <label
                                key={option.label}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-white/10"
                              >
                                <input
                                  type="radio"
                                  name="pinned-message-duration"
                                  checked={selectedDuration === option.value}
                                  onChange={() => setSelectedDuration(option.value)}
                                  className="cursor-pointer accent-[#9146FF]"
                                  disabled={pinActionBusy}
                                />
                                <span>{option.label}</span>
                              </label>
                            ))}
                            <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-white/10">
                              <input
                                type="radio"
                                name="pinned-message-duration"
                                checked={selectedDuration === CUSTOM_TWITCH_PIN_DURATION}
                                onChange={() => setSelectedDuration(CUSTOM_TWITCH_PIN_DURATION)}
                                className="cursor-pointer accent-[#9146FF]"
                                disabled={pinActionBusy}
                              />
                              <span>{i18n.t("chat.custom")}</span>
                            </label>
                          </fieldset>
                          {selectedDuration === CUSTOM_TWITCH_PIN_DURATION ? (
                            <div className="mt-2 flex items-center gap-2 px-2">
                              <input
                                type="number"
                                min={1}
                                step={1}
                                inputMode="numeric"
                                aria-label={i18n.t("chat.customPinDuration")}
                                value={customDurationAmount}
                                onChange={(event) => setCustomDurationAmount(event.target.value)}
                                onFocus={() => setSelectedDuration(CUSTOM_TWITCH_PIN_DURATION)}
                                disabled={pinActionBusy}
                                className="h-8 min-w-0 flex-1 rounded border border-[rgba(83,83,95,0.72)] bg-[#0e0e10] px-2 text-sm text-[#EFEFF1] outline-none focus:border-[#a970ff] disabled:cursor-not-allowed disabled:opacity-60"
                              />
                              <select
                                aria-label={i18n.t("chat.customPinDurationUnit")}
                                value={customDurationUnit}
                                onChange={(event) =>
                                  setCustomDurationUnit(event.target.value as TwitchPinDurationUnit)
                                }
                                disabled={pinActionBusy}
                                className="h-8 rounded border border-[rgba(83,83,95,0.72)] bg-[#0e0e10] px-2 text-sm text-[#EFEFF1] outline-none focus:border-[#a970ff] disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <option value="seconds">{i18n.t("chat.secs")}</option>
                                <option value="minutes">{i18n.t("chat.mins")}</option>
                              </select>
                            </div>
                          ) : null}
                          <button
                            type="button"
                            onClick={handleApplyDuration}
                            disabled={pinActionBusy || !canApplyDuration}
                            className="mt-2 flex h-8 w-full items-center justify-center rounded bg-[#9146FF] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#772ce8] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {pinActionBusy ? i18n.t("chat.applying") : i18n.t("chat.apply")}
                          </button>
                        </div>
                      ) : null}
                      {onUpdateDuration && (onDismiss || onUnpin) ? (
                        <div className="my-2 h-px bg-[rgba(83,83,95,0.72)]" />
                      ) : null}
                      {onDismiss ? (
                        <div className="px-2">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setIsMenuOpen(false);
                              onDismiss();
                            }}
                            disabled={pinActionBusy}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#EFEFF1] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <EyeOffIcon className="h-4 w-4 flex-shrink-0" />
                            <span>{i18n.t("chat.hideForYourself")}</span>
                          </button>
                        </div>
                      ) : null}
                      {onDismiss && onUnpin ? (
                        <div className="my-2 h-px bg-[rgba(83,83,95,0.72)]" />
                      ) : null}
                      {onUnpin ? (
                        <div className="px-2">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setIsMenuOpen(false);
                              onUnpin();
                            }}
                            disabled={pinActionBusy}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[#ff8280] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <EyeOffIcon className="h-4 w-4 flex-shrink-0" />
                            <span>{i18n.t("chat.unpinMessage")}</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <button
                type="button"
                onClick={onExpandToggle}
                className={ICON_BUTTON_CLASS}
                aria-label={
                  isExpanded
                    ? i18n.t("chat.collapsePinnedMessage")
                    : i18n.t("chat.expandPinnedMessage")
                }
              >
                <BsChevronDown
                  data-testid="pinned-message-expand-icon"
                  size={22}
                  style={{
                    stroke: "currentColor",
                    strokeWidth: 1.35,
                    transform: isExpanded ? "rotate(180deg)" : "none",
                    transition: "transform 0.2s",
                  }}
                />
              </button>
            </div>
          </div>

          {/* Message body: just the content. Twitch's native card omits the
           * sender entirely in collapsed state — the "Pinned by X" header is
           * the only attribution. 18px / weight 500 / 1.3 line-height.
           *
           * Collapsed body shows a short preview so long pins do not cover the
           * chat. Expanded body removes the cap and wraps fully; long URLs fall
           * back to `break-all` on the link fragment itself. */}
          <div
            className={`mt-0.5 text-lg font-medium leading-snug text-[#EFEFF1] break-words ${
              isExpanded ? "" : "overflow-hidden"
            }`}
            data-testid="pinned-message-content"
            data-expanded={isExpanded ? "true" : "false"}
            style={isExpanded ? undefined : COLLAPSED_CONTENT_STYLE}
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
                  {i18n.t("chat.sentAtValue0", { value0: formatSentAt(pin.sentAt) })}
                </span>
              ) : null}
            </div>
          ) : null}

          {isExpanded && progressWidth && progressState ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <div
                  className="group mt-2 h-5 cursor-pointer py-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
                  data-testid="pinned-message-duration-progress-slot"
                  tabIndex={0}
                >
                  <div
                    role="progressbar"
                    aria-label={i18n.t("chat.pinnedMessageDuration")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressAriaValue}
                    aria-valuetext={progressState.timeLeftLabel}
                    className="h-1 w-full overflow-hidden rounded-[9000px] bg-[rgba(83,83,95,0.55)] transition-colors duration-150 group-hover:bg-[rgba(83,83,95,0.78)] group-focus-visible:bg-[rgba(83,83,95,0.78)]"
                    data-testid="pinned-message-duration-progress"
                  >
                    <div
                      className={`h-full bg-[#A970FF] transition-[width,background-color] duration-[250ms] ease-linear group-hover:bg-[#BF94FF] group-focus-visible:bg-[#BF94FF] ${
                        progressAriaValue === 100 ? "rounded-[9000px]" : "rounded-l-[9000px]"
                      }`}
                      data-testid="pinned-message-duration-progress-fill"
                      style={{ width: progressWidth }}
                    />
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent
                className={TWITCH_CHAT_ACTION_TOOLTIP_CLASS}
                arrowClassName={TWITCH_CHAT_ACTION_TOOLTIP_ARROW_CLASS}
              >
                {progressState.timeLeftLabel}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
};

PinnedMessageBanner.displayName = "PinnedMessageBanner";
