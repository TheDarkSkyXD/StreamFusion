import { WifiOff } from "lucide-react";

import type { PlatformHealth } from "@/backend/api/unified/platform-health";
import { usePlatformHealth } from "@/hooks/usePlatformHealth";

export function PlatformHealthBanner() {
  const { kick, twitch, anyDegraded, details = {} } = usePlatformHealth();

  if (!anyDegraded) return null;

  const kickUnhealthy = kick !== "healthy";
  const twitchUnhealthy = twitch !== "healthy";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2.5 px-4 py-4 text-lg font-bold text-center ${platformColors(kick, twitch)}`}
    >
      <WifiOff className="h-5 w-5 shrink-0" />
      <span>{computeMessage(kick, twitch, details.kick?.summary, details.twitch?.summary)}</span>
    </div>
  );
}

function computeMessage(
  kick: PlatformHealth,
  twitch: PlatformHealth,
  kickSummary?: string,
  twitchSummary?: string
): string {
  if (kick !== "healthy" && twitch !== "healthy") {
    const bothDown = kick === "down" && twitch === "down";
    if (bothDown) return "Kick and Twitch are both unreachable. Retrying...";
    if (kickSummary != null && twitchSummary != null) return `${kickSummary} ${twitchSummary}`;
    return "Kick and Twitch are degraded right now. Some data may be cached or delayed.";
  }
  if (twitch !== "healthy") {
    if (twitch === "down") return "Twitch is unreachable. Retrying...";
    if (twitchSummary != null) return twitchSummary;
    return "Twitch is having issues right now. Some channels may not load.";
  }
  if (kick === "down") return "Kick is unreachable. Retrying...";
  if (kickSummary != null) return kickSummary;
  return "Kick is degraded right now. Some Kick data may be cached or delayed.";
}

function platformColors(kick: PlatformHealth, twitch: PlatformHealth): string {
  const kickUnhealthy = kick !== "healthy";
  const twitchUnhealthy = twitch !== "healthy";
  if (kickUnhealthy && twitchUnhealthy) return "bg-gray-700 text-white";
  if (twitchUnhealthy) return "bg-[#9146FF] text-white";
  return "bg-black text-[#53FC18]";
}
