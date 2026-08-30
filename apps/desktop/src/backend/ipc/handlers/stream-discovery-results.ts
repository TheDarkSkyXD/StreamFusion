import type { Platform } from "../../../shared/auth-types";
import type { DiscoveryProviderStatus, DiscoveryResult } from "../../../shared/discovery-types";
import type { UnifiedStream } from "../../../shared/platform-types";

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
  const byPlatform = new Map(outcomes.map((outcome) => [outcome.platform, outcome]));
  const providers = Object.fromEntries(
    requestedPlatforms.map((platform) => [platform, byPlatform.get(platform)?.status ?? "failed"])
  );
  const usable = requestedPlatforms
    .map((platform) => byPlatform.get(platform))
    .filter(
      (outcome): outcome is StreamProviderOutcome =>
        outcome !== undefined && outcome.status !== "failed"
    );

  if (usable.length === 0) {
    const errors = requestedPlatforms
      .map((platform) => byPlatform.get(platform)?.error ?? `${platform} unavailable`)
      .filter((error, index, all) => all.indexOf(error) === index);
    return {
      success: false,
      error: errors.join("; "),
      providers,
      ...(requestedPlatforms.length === 1 ? { platform: requestedPlatforms[0] } : {}),
    };
  }

  const data = usable.flatMap((outcome) => outcome.data);
  if (requestedPlatforms.length > 1) data.sort((a, b) => b.viewerCount - a.viewerCount);
  const first = requestedPlatforms.length === 1 ? usable[0] : undefined;
  return {
    success: true,
    data: limit === undefined ? data : data.slice(0, limit),
    providers,
    ...(first ? { platform: first.platform } : {}),
    ...(first?.cursor ? { cursor: first.cursor } : {}),
  };
}
