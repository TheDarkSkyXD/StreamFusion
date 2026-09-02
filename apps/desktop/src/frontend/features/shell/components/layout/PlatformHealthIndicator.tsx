import { WifiOff } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { PlatformHealth } from "@backend/api/unified/platform-health";
import { usePlatformHealth } from "@/features/settings/data/usePlatformHealth";

export function PlatformHealthIndicator() {
  const { t } = useTranslation();
  const { kick, twitch, anyDegraded, details = {} } = usePlatformHealth();
  const kickDisplayHealth = kick === "down" || details.kick != null ? kick : "healthy";
  const hasVisibleIssue = kickDisplayHealth !== "healthy" || twitch !== "healthy";

  if (!anyDegraded || !hasVisibleIssue) return null;

  const message = computeMessage(
    kickDisplayHealth,
    twitch,
    t,
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
      <span className="hidden xl:inline">{compactLabel(kickDisplayHealth, twitch, t)}</span>
    </div>
  );
}

function compactLabel(kick: PlatformHealth, twitch: PlatformHealth, t: TFunction): string {
  if (kick !== "healthy" && twitch !== "healthy") return t("shell.platformHealth.issues");
  if (twitch !== "healthy") {
    return twitch === "down"
      ? t("shell.platformHealth.twitchOffline")
      : t("shell.platformHealth.twitchDegraded");
  }
  return kick === "down"
    ? t("shell.platformHealth.kickOffline")
    : t("shell.platformHealth.kickDegraded");
}

function computeMessage(
  kick: PlatformHealth,
  twitch: PlatformHealth,
  t: TFunction,
  kickSummary?: string,
  twitchSummary?: string
): string {
  if (kick !== "healthy" && twitch !== "healthy") {
    if (kick === "down" && twitch === "down") return t("shell.platformHealth.bothUnreachable");
    if (kickSummary != null && twitchSummary != null) return `${kickSummary} ${twitchSummary}`;
    return t("shell.platformHealth.bothDegraded");
  }
  if (twitch !== "healthy") {
    if (twitch === "down") return t("shell.platformHealth.twitchUnreachable");
    return twitchSummary ?? t("shell.platformHealth.twitchDegradedMessage");
  }
  if (kick === "down") return t("shell.platformHealth.kickUnreachable");
  return kickSummary ?? t("shell.platformHealth.kickDegradedMessage");
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
