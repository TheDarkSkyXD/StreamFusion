import { getBundledBadgeUrl } from "@/assets/platforms/kick/badges";
import type { Platform } from "@shared/auth-types";

const KICK_VERIFIED_BADGE_URL = getBundledBadgeUrl("verified");

interface StreamVerifiedBadgeProps {
  platform: Platform;
  className?: string;
}

export function StreamVerifiedBadge({
  platform,
  className = "h-3.5 w-3.5",
}: StreamVerifiedBadgeProps) {
  const label = platform === "twitch" ? "Twitch verified" : "Kick verified";

  if (platform === "kick" && KICK_VERIFIED_BADGE_URL) {
    return (
      <img
        src={KICK_VERIFIED_BADGE_URL}
        alt={label}
        title={label}
        className={`${className} shrink-0 object-contain`}
        loading="lazy"
      />
    );
  }

  return (
    <svg aria-label={label} role="img" viewBox="0 0 16 16" className={`${className} shrink-0`}>
      <path
        d="M8 1.25 9.58 3l2.31-.49.73 2.24 2.13 1.01-.86 2.19.86 2.19-2.13 1.01-.73 2.24-2.31-.49L8 14.65 6.42 12.9l-2.31.49-.73-2.24-2.13-1.01.86-2.19-.86-2.19 2.13-1.01.73-2.24L6.42 3 8 1.25Z"
        fill="#9146FF"
      />
      <path d="m6.95 10.26-2.1-2.1.88-.88 1.22 1.22 3.32-3.32.88.88-4.2 4.2Z" fill="#FFFFFF" />
    </svg>
  );
}
