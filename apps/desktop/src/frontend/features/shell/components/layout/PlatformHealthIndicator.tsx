import { WifiOff } from "lucide-react";

import type { PlatformHealth } from "@backend/api/unified/platform-health";
import { usePlatformHealth } from "@/features/settings/data/usePlatformHealth";

export function PlatformHealthIndicator() {
  const { kick, twitch, anyDegraded, details = {} } = usePlatformHealth();
  const kickDisplayHealth = kick === "down" || details.kick != null ? kick : "healthy";
  const hasVisibleIssue = kickDisplayHealth !== "healthy" || twitch !== "healthy";

  if (!anyDegraded || !hasVisibleIssue) return null;

  const message = computeMessage(
    kickDisplayHealth,
    twitch,
    details.kick?.summary,
    details.twitch?.summary
  );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message}
      title={message}
      className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-2.5 text-xs font-semibold ${platformColors(kickDisplayHealth, twitch)}`}
    >
      <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden xl:inline">{compactLabel(kickDisplayHealth, twitch)}</span>
    </div>
  );
}

function compactLabel(kick: PlatformHealth, twitch: PlatformHealth): string {
  if (kick !== "healthy" && twitch !== "healthy") return "Platform issues";
  if (twitch !== "healthy") return twitch === "down" ? "Twitch offline" : "Twitch degraded";
  return kick === "down" ? "Kick offline" : "Kick degraded";
}

function computeMessage(
  kick: PlatformHealth,
  twitch: PlatformHealth,
  kickSummary?: string,
  twitchSummary?: string
): string {
  if (kick !== "healthy" && twitch !== "healthy") {
    if (kick === "down" && twitch === "down") return "Kick and Twitch are unreachable. Retrying.";
    if (kickSummary != null && twitchSummary != null) return `${kickSummary} ${twitchSummary}`;
    return "Kick and Twitch are degraded. Some data may be cached or delayed.";
  }
  if (twitch !== "healthy") {
    if (twitch === "down") return "Twitch is unreachable. Retrying.";
    return twitchSummary ?? "Twitch is degraded. Some channels may not load.";
  }
  if (kick === "down") return "Kick is unreachable. Retrying.";
  return kickSummary ?? "Kick is degraded. Some Kick data may be cached or delayed.";
}

function platformColors(kick: PlatformHealth, twitch: PlatformHealth): string {
  const kickUnhealthy = kick !== "healthy";
  const twitchUnhealthy = twitch !== "healthy";
  if (kickUnhealthy && twitchUnhealthy) {
    return "border-amber-300/30 bg-amber-300/10 text-amber-200";
  }
  if (twitchUnhealthy) return "border-[#9146FF]/40 bg-[#9146FF]/15 text-[#c8a7ff]";
  return "border-[#53FC18]/35 bg-[#53FC18]/10 text-[#8aff62]";
}
