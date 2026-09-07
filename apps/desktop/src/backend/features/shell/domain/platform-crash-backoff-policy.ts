import { Platform } from "@streamfusion/core/platform";

export type PlatformCrashBackoffReason = "gpu-process-gone" | "network-service-gone";

export interface ChildProcessGoneDetailsLike {
  type?: string;
  serviceName?: string;
  name?: string;
}

export interface PlatformCrashBackoffDecision {
  platforms: readonly Platform[];
  reason: PlatformCrashBackoffReason;
}

const NETWORK_SERVICE_NAME = "network.mojom.NetworkService";
const NETWORK_SERVICE_DISPLAY_NAME = "Network Service";
const ALL_PLATFORMS = ["kick", "twitch"] as const satisfies readonly Platform[];

export function getPlatformCrashBackoffDecision(
  details: ChildProcessGoneDetailsLike
): PlatformCrashBackoffDecision | null {
  if (details.type === "GPU") {
    return {
      platforms: ALL_PLATFORMS,
      reason: "gpu-process-gone",
    };
  }

  if (
    details.type === "Utility" &&
    (details.serviceName === NETWORK_SERVICE_NAME || details.name === NETWORK_SERVICE_DISPLAY_NAME)
  ) {
    return {
      platforms: ALL_PLATFORMS,
      reason: "network-service-gone",
    };
  }

  return null;
}
