import type { Platform } from "./auth-types";

export type DiscoveryProviderStatus = "complete" | "partial" | "stale" | "failed";

/**
 * Explicit provider outcome for an exhaustive discovery request. Missing
 * entries are never equivalent to success at cache-admission boundaries.
 */
export type DiscoveryProviderCompletion = Partial<Record<Platform, DiscoveryProviderStatus>>;

export type DiscoveryResult<T> =
  | {
      success: true;
      data: T;
      cursor?: string;
      platform?: Platform;
      providers: DiscoveryProviderCompletion;
    }
  | {
      success: false;
      error: string;
      platform?: Platform;
      providers: DiscoveryProviderCompletion;
    };

export function hasCompleteDiscoveryCoverage(
  providers: DiscoveryProviderCompletion,
  platform?: Platform
): boolean {
  return platform
    ? providers[platform] === "complete"
    : providers.twitch === "complete" && providers.kick === "complete";
}
