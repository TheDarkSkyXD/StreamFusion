import { useTranslation } from "react-i18next";
/**
 * InfoBanner — chat-room-mode banner shown above ChatInput.
 *
 * Translates the active {@link RoomState} for a (platform, channelId) pair
 * into a single primary visible label plus a right-aligned info icon whose
 * tooltip lists every active mode on its own row. Mirrors KickTalk's
 * `Chat/Input/InfoBar.jsx` precedence + tooltip pattern, ported to Tailwind
 * + StreamFusion's Radix `Tooltip` primitive (no SCSS).
 *
 * Precedence for the visible label (R14):
 *   followersOnly → subscribersOnly → accountAge → emoteOnly → slowMode
 *
 * `accountAge` is displayed only on Kick. Twitch's `uniqueChat` and
 * `shieldMode` room-state fields are intentionally not displayed here.
 *
 * Returns `null` when no mode is active.
 */

import type React from "react";
import { useChatRoomState } from "../../data/useChatRoomState";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../components/ui/tooltip";
import { ViewerRequirementState } from "@streamfusion/core/chat";

/**
 * Convert a seconds count to a compact human-readable interval.
 * Examples: `30s`, `1m`, `2m 30s`, `1h`, `1h 5m`.
 *
 * Per PF13 this lives module-scoped inside InfoBanner — the only consumer
 * today. Move to a shared util when a second consumer emerges.
 */
function convertSecondsToHumanReadable(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
  }
  const h = Math.floor(s / 3600);
  const remM = Math.floor((s % 3600) / 60);
  return remM === 0 ? `${h}h` : `${h}h ${remM}m`;
}

/** An active-mode descriptor. The primary label uses `label`; the tooltip
 *  uses `tooltipLabel`. Order in the precedence array drives both the
 *  picked-primary and the tooltip-row order, so the user sees the same
 *  vertical priority in both surfaces. */
interface ActiveMode {
  /** Stable key for React lists. */
  key: string;
  /** Label as rendered when this mode is the visible primary. */
  label: string;
  /** Label as rendered inside the tooltip's per-mode row. */
  tooltipLabel: string;
}

export interface InfoBannerProps {
  platform: ChatPlatform;
  channelId: string | null;
  viewerSatisfiesFollowerOnly?: boolean;
  viewerAccountAgeRequirement?: ViewerRequirementState;
}

export const InfoBanner: React.FC<InfoBannerProps> = ({
  platform,
  channelId,
  viewerSatisfiesFollowerOnly = false,
  viewerAccountAgeRequirement = "unknown",
}) => {
  const { t } = useTranslation();
  const state = useChatRoomState(platform, channelId);

  // Build the precedence-ordered list of chat restrictions relevant to the viewer.
  // Account age remains Kick-only; Unique Chat and Shield Mode are intentionally
  // excluded from this user-facing banner.
  const active: ActiveMode[] = [];

  if (!viewerSatisfiesFollowerOnly && state.followersOnly !== null && state.followersOnly >= 0) {
    const n = state.followersOnly;
    active.push({
      key: "followers",
      label:
        n > 0 ? t("chat.followersOnlyModeValue0M", { value0: n }) : t("chat.followersOnlyMode"),
      tooltipLabel: n > 0 ? `Followers Only Mode Enabled [${n}m]` : "Followers Only Mode Enabled",
    });
  }

  if (state.subscribersOnly) {
    active.push({
      key: "subscribers",
      label: t("chat.subscribersOnlyMode"),
      tooltipLabel: "Subscribers Only Mode Enabled",
    });
  }

  if (
    platform === "kick" &&
    viewerAccountAgeRequirement === "restricted" &&
    state.accountAge !== null &&
    state.accountAge > 0
  ) {
    const n = state.accountAge;
    active.push({
      key: "accountAge",
      label: t("chat.accountAgeModeValue0M", { value0: n }),
      tooltipLabel: `Account Age Restriction Enabled [${n}m]`,
    });
  }

  if (state.emoteOnly) {
    active.push({
      key: "emoteOnly",
      label: t("chat.emoteOnlyMode"),
      tooltipLabel: "Emote Only Mode Enabled",
    });
  }

  if (state.slowMode !== null && state.slowMode > 0) {
    const interval = convertSecondsToHumanReadable(state.slowMode);
    active.push({
      key: "slow",
      label: t("chat.slowModeValue0", { value0: interval }),
      tooltipLabel: `Slow Mode Enabled [${interval}]`,
    });
  }

  if (active.length === 0) return null;

  // First entry in the active list = the precedence winner = visible label.
  const primary = active[0];

  return (
    <div
      data-testid="info-banner"
      data-platform={platform}
      className="mb-1 flex items-center gap-1 rounded-md border border-[var(--color-border,rgba(83,83,95,0.48))] bg-[#262626] px-2 py-0.5 text-sm font-semibold text-[var(--color-foreground,#EFEFF1)]"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t("chat.activeChatModes")}
            data-testid="info-banner-icon"
            className="flex-shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full text-[#d3d3d9] hover:text-white focus:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            {primary.key === "slow" ? <SlowModeIcon size={16} /> : <InfoIcon />}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div data-testid="info-banner-tooltip" className="flex flex-col gap-1 text-xs">
            {active.map((mode) => (
              <span
                key={mode.key}
                data-testid={`info-banner-tooltip-row-${mode.key}`}
                className="flex items-center gap-1"
              >
                {mode.key === "slow" && <SlowModeIcon size={12} />}
                {mode.tooltipLabel}
              </span>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
      <span data-testid="info-banner-primary" className="min-w-0 truncate">
        {primary.label}
      </span>
    </div>
  );
};

InfoBanner.displayName = "InfoBanner";

/**
 * Inline info-fill SVG — same shape KickTalk uses (`info-fill.svg`),
 * rendered at 14×14 to match the banner's 12px text scale.
 */
const InfoIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
    fill="currentColor"
  >
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm1 5v2h-2V6h2Zm0 4v8h-2v-8h2Z"
    />
  </svg>
);

const SlowModeIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    fill="#A8ADB3"
  >
    <path d="M15 3.9c0-.5-.4-.9-.9-.9s-.8.4-.8.9c0 .3.1.6.4.7v1h-1.8v-1c.3-.1.5-.4.5-.7 0-.5-.4-.9-.9-.9s-.9.4-.9.9c0 .3.2.6.5.7v1L9.7 6.7a4.4 4.4 0 1 0-7 4.2l-1.7.8v1.8h10.5l3-3.5V4.6c.3-.1.5-.4.5-.7Zm-9.6.9a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.3Z" />
    <path d="M7.1 7.2H5.6V5.6H4.3v2.9H7V7.2Z" />
  </svg>
);
