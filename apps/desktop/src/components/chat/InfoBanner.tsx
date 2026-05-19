/**
 * InfoBanner — chat-room-mode banner shown above ChatInput.
 *
 * Translates the active {@link RoomState} for a (platform, channelId) pair
 * into a single primary visible label plus a right-aligned info icon whose
 * tooltip lists every active mode on its own row. Mirrors KickTalk's
 * `Chat/Input/InfoBar.jsx` precedence + tooltip pattern, ported to Tailwind
 * + StreamForge's Radix `Tooltip` primitive (no SCSS).
 *
 * Precedence for the visible label (R14):
 *   followersOnly → subscribersOnly → accountAge → emoteOnly → slowMode
 *
 * The Twitch-only modes `uniqueChat` and `shieldMode` never displace any of
 * the five above. They contribute to the tooltip list when active and only
 * surface as the visible label if every higher-precedence mode is inactive.
 *
 * Platform asymmetry is encoded explicitly: `accountAge` is read only on
 * Kick; `uniqueChat` / `shieldMode` are read only on Twitch. The underlying
 * fetchers don't populate the wrong-platform fields, so this is
 * belt-and-suspenders — but it keeps the rule legible at the call-site.
 *
 * Returns `null` when no mode is active.
 */

import type React from "react";
import type { ChatPlatform } from "../../shared/chat-types";
import { useChatRoomState } from "../../hooks/useChatRoomState";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

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
}

export const InfoBanner: React.FC<InfoBannerProps> = ({ platform, channelId }) => {
  const state = useChatRoomState(platform, channelId);

  // Build the precedence-ordered list of active modes. Platform asymmetry
  // is enforced here: only read accountAge on Kick, only read
  // uniqueChat / shieldMode on Twitch. The store contract already keeps
  // wrong-platform fields at their default, but this check makes the
  // platform rule visible at the call-site.
  const active: ActiveMode[] = [];

  if (state.followersOnly !== null && state.followersOnly >= 0) {
    const n = state.followersOnly;
    active.push({
      key: "followers",
      label: n > 0 ? `Followers Only Mode [${n}m]` : "Followers Only Mode",
      tooltipLabel:
        n > 0
          ? `Followers Only Mode Enabled [${n}m]`
          : "Followers Only Mode Enabled",
    });
  }

  if (state.subscribersOnly) {
    active.push({
      key: "subscribers",
      label: "Subscribers Only Mode",
      tooltipLabel: "Subscribers Only Mode Enabled",
    });
  }

  if (platform === "kick" && state.accountAge !== null && state.accountAge > 0) {
    const n = state.accountAge;
    active.push({
      key: "accountAge",
      label: `Account Age Mode [${n}m]`,
      tooltipLabel: `Account Age Restriction Enabled [${n}m]`,
    });
  }

  if (state.emoteOnly) {
    active.push({
      key: "emoteOnly",
      label: "Emote Only Mode",
      tooltipLabel: "Emote Only Mode Enabled",
    });
  }

  if (state.slowMode !== null && state.slowMode > 0) {
    const interval = convertSecondsToHumanReadable(state.slowMode);
    active.push({
      key: "slow",
      label: `Slow Mode [${interval}]`,
      tooltipLabel: `Slow Mode Enabled [${interval}]`,
    });
  }

  // Twitch-only fallback modes. These never displace one of the five above
  // for the visible primary label — they're appended to `active` AFTER the
  // precedence chain, so they only become the primary when every higher
  // mode is inactive.
  if (platform === "twitch" && state.uniqueChat) {
    active.push({
      key: "uniqueChat",
      label: "Unique Chat Mode",
      tooltipLabel: "Unique Chat Mode Enabled",
    });
  }

  if (platform === "twitch" && state.shieldMode) {
    active.push({
      key: "shieldMode",
      label: "Shield Mode",
      tooltipLabel: "Shield Mode Enabled",
    });
  }

  if (active.length === 0) return null;

  // First entry in the active list = the precedence winner = visible label.
  const primary = active[0];

  return (
    <div
      data-testid="info-banner"
      data-platform={platform}
      className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs text-[var(--color-foreground,#EFEFF1)] bg-[var(--color-background-secondary,#1a1a1d)] border-b border-[var(--color-border,rgba(83,83,95,0.48))]"
    >
      <span data-testid="info-banner-primary" className="truncate font-medium">
        {primary.label}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Active chat modes"
            data-testid="info-banner-icon"
            className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[var(--color-foreground-muted,#a1a1aa)] hover:text-white focus:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white"
          >
            <InfoIcon />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div
            data-testid="info-banner-tooltip"
            className="flex flex-col gap-1 text-xs"
          >
            {active.map((mode) => (
              <span key={mode.key} data-testid={`info-banner-tooltip-row-${mode.key}`}>
                {mode.tooltipLabel}
              </span>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
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
    width="14"
    height="14"
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    fill="currentColor"
  >
    <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.75a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0Zm1.5 6.5a.75.75 0 0 1-1.5 0v-3.5a.75.75 0 0 1 1.5 0v3.5Z" />
  </svg>
);
