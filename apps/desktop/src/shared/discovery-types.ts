import type { Platform } from "./auth-types";

export type DiscoveryProviderStatus = "complete" | "failed";

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
