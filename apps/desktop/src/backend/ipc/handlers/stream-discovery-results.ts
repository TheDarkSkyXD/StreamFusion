import type { Platform } from "../../../shared/auth-types";
import type { DiscoveryProviderStatus, DiscoveryResult } from "../../../shared/discovery-types";
import type { UnifiedStream } from "../../../shared/platform-types";
import { settleDiscoveryProviders } from "@streamfusion/core/discovery";

export interface StreamProviderOutcome {
  platform: Platform;
  status: DiscoveryProviderStatus;
  data: UnifiedStream[];
  cursor?: string;
  error?: string;
}

export function settleStreamProviders(
  requestedPlatforms: readonly Platform[],
  outcomes: readonly StreamProviderOutcome[],
  limit?: number
): DiscoveryResult<UnifiedStream[]> {
  return settleDiscoveryProviders({
    requestedPlatforms,
    outcomes,
    ...(limit === undefined ? {} : { limit }),
    compare: (left, right) => right.viewerCount - left.viewerCount,
  });
}
