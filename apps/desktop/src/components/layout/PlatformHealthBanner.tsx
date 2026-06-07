import { WifiOff } from "lucide-react";

import { usePlatformHealth } from "@/hooks/usePlatformHealth";

export function PlatformHealthBanner() {
  const { kick, twitch, anyDegraded } = usePlatformHealth();

  if (!anyDegraded) return null;

  const kickDegraded = kick === "degraded";
  const twitchDegraded = twitch === "degraded";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2.5 px-4 py-4 text-lg font-bold text-center ${platformColors(kickDegraded, twitchDegraded)}`}
    >
      <WifiOff className="h-5 w-5 shrink-0" />
      <span>{computeMessage(kickDegraded, twitchDegraded)}</span>
    </div>
  );
}

function computeMessage(kickDegraded: boolean, twitchDegraded: boolean): string {
  if (kickDegraded && twitchDegraded) {
    return "Kick and Twitch are both having issues right now. Showing last-known state.";
  }
  if (twitchDegraded) {
    return "Twitch is having issues right now. Some channels may not load.";
  }
  return "Kick is having issues right now. Showing last-known state.";
}

function platformColors(kickDegraded: boolean, twitchDegraded: boolean): string {
  if (kickDegraded && twitchDegraded) return "bg-gray-700 text-white";
  if (twitchDegraded) return "bg-[#9146FF] text-white";
  return "bg-black text-[#53FC18]";
}
