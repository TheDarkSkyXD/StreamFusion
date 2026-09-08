import type { ActivityItem } from "@streamfusion/core/activity";

export type ActivityVisualKind = "channel" | "job" | "system";

export interface ActivityPresentation {
  readonly deliveryLabel: "Local" | "Relay";
  readonly eventIdentity: string;
  readonly kindLabel: "Channel" | "Job" | "System";
  readonly provenanceLabel: string;
  readonly visual: ActivityVisualKind;
}

function platformLabel(platform: "twitch" | "kick"): "Twitch" | "Kick" {
  return platform === "twitch" ? "Twitch" : "Kick";
}

export function presentActivityItem(item: ActivityItem): ActivityPresentation {
  const deliveryLabel = item.source === "local" ? "Local" : "Relay";
  if (item.kind === "channel") {
    const platform = platformLabel(item.channel.platform);
    return {
      deliveryLabel,
      eventIdentity: item.eventId,
      kindLabel: "Channel",
      provenanceLabel: `${platform} · ${deliveryLabel}`,
      visual: "channel",
    };
  }

  const kindLabel = item.kind === "job" ? "Job" : "System";
  return {
    deliveryLabel,
    eventIdentity: item.eventId,
    kindLabel,
    provenanceLabel: `${kindLabel} · ${deliveryLabel}`,
    visual: item.kind,
  };
}
