/**
 * UserProfileHeader (U16)
 *
 * Top section of the user popout: avatar, display name, account creation
 * date, follow-since timestamp, and a row of badges (sub / VIP / mod /
 * founder / verified). Missing fields render as em-dash rather than
 * suppressing the row entirely so the layout stays stable.
 */

import { LuShieldCheck, LuStar, LuBadgeCheck, LuCrown } from "react-icons/lu";

import type { UserProfile } from "./useUserProfile";

interface UserProfileHeaderProps {
  profile: UserProfile;
  platform: "twitch" | "kick";
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const TIER_LABEL: Record<string, string> = {
  "1000": "Tier 1",
  "2000": "Tier 2",
  "3000": "Tier 3",
};

export function UserProfileHeader({ profile, platform }: UserProfileHeaderProps) {
  const fallbackColor = platform === "kick" ? "#53fc18" : "#9146ff";
  return (
    <div className="flex gap-4 items-start">
      <div
        className="w-16 h-16 rounded-full overflow-hidden flex-shrink-0 bg-white/10 border border-white/10"
        aria-hidden
      >
        {profile.avatarUrl ? (
          // biome-ignore lint/performance/noImgElement: small avatar; Next/Image unavailable in Electron renderer.
          <img
            src={profile.avatarUrl}
            alt=""
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{ backgroundColor: fallbackColor }}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <div
            className="text-lg font-semibold truncate"
            style={{ color: fallbackColor }}
          >
            {profile.displayName}
          </div>
          {profile.verified ? (
            <LuBadgeCheck className="w-4 h-4 text-sky-400" aria-label="Verified" />
          ) : null}
        </div>
        <div className="text-xs text-[var(--color-foreground-muted)] mt-0.5">
          @{profile.username}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-[var(--color-foreground-muted)]">Account created</dt>
          <dd className="text-white">{formatDate(profile.createdAt)}</dd>
          <dt className="text-[var(--color-foreground-muted)]">Following since</dt>
          <dd className="text-white">{formatDate(profile.followSince ?? "")}</dd>
        </dl>
        <div
          className="mt-3 flex flex-wrap gap-1.5"
          data-testid="user-profile-badges"
        >
          {profile.subscription ? (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">
              <LuStar className="w-3 h-3" />
              {TIER_LABEL[profile.subscription.tier ?? ""] ?? "Sub"}
              {profile.subscription.isGift ? " (gift)" : ""}
            </span>
          ) : null}
          {profile.isFounder ? (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <LuCrown className="w-3 h-3" />
              Founder
            </span>
          ) : null}
          {profile.isVip ? (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-pink-500/15 text-pink-300 border border-pink-500/30">
              VIP
            </span>
          ) : null}
          {profile.isMod ? (
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              <LuShieldCheck className="w-3 h-3" />
              Mod
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
