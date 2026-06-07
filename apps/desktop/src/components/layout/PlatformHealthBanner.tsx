import { WifiOff } from "lucide-react";

import type { PlatformHealth } from "@/backend/api/unified/platform-health";
import { usePlatformHealth } from "@/hooks/usePlatformHealth";

export function PlatformHealthBanner() {
  const { kick, twitch, anyDegraded } = usePlatformHealth();

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
      <span>{computeMessage(kick, twitch)}</span>
    </div>
  );
}

function computeMessage(kick: PlatformHealth, twitch: PlatformHealth): string {
  if (kick !== "healthy" && twitch !== "healthy") {
    const bothDown = kick === "down" && twitch === "down";
    if (bothDown) return "Kick and Twitch are both unreachable. Retrying...";
    return "Kick and Twitch are both having issues right now. Showing last-known state.";
  }
  if (twitch !== "healthy") {
    if (twitch === "down") return "Twitch is unreachable. Retrying...";
    return "Twitch is having issues right now. Some channels may not load.";
  }
  if (kick === "down") return "Kick is unreachable. Retrying...";
  return "Kick is having issues right now. Showing last-known state.";
}

function platformColors(kick: PlatformHealth, twitch: PlatformHealth): string {
  const kickUnhealthy = kick !== "healthy";
  const twitchUnhealthy = twitch !== "healthy";
  if (kickUnhealthy && twitchUnhealthy) return "bg-gray-700 text-white";
  if (twitchUnhealthy) return "bg-[#9146FF] text-white";
  return "bg-black text-[#53FC18]";
}
