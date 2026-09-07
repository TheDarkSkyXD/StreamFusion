import { authenticationRepository } from "@backend/features/authentication/data/authentication-repository";
import { createManagedInterval } from "@shared/utils/managed-interval";
import { kickTransport } from "@backend/api/platforms/kick/kick-transport";
import * as KickChannels from "@backend/features/discovery/adapters/kick/channel-endpoints";
import { logger } from "../../../../logging/logger";
import { isKickAccountReconciliationActive } from "../../domain/kick-account-reconciliation-coordinator";
import { resolveKickFollowMetadata } from "./kick-follow-identity-service";

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let refreshTimer: { stop: () => void } | null = null;
let lastRefreshStartedAt = 0;
let inFlightRefresh: Promise<void> | null = null;

export async function refreshKickFollowMetadataNow(
  reason: string,
  options: { force?: boolean } = {}
): Promise<void> {
  if (isKickAccountReconciliationActive()) {
    logger.debug(
      "Service:KickFollowMetadata",
      "Deferring metadata refresh during follow reconciliation",
      {
        reason,
      }
    );
    return;
  }
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  const now = Date.now();
  if (!options.force && now - lastRefreshStartedAt < MIN_REFRESH_INTERVAL_MS) {
    logger.debug("Service:KickFollowMetadata", "Skipping Kick follow metadata refresh", {
      reason,
      msSinceLastRefresh: now - lastRefreshStartedAt,
    });
    return;
  }

  lastRefreshStartedAt = now;
  inFlightRefresh = (async () => {
    const follows = authenticationRepository.getLocalFollowsByPlatform("kick");
    if (follows.length === 0) {
      logger.debug("Service:KickFollowMetadata", "No Kick follows to refresh", { reason });
      return;
    }

    const resolvedChannels = await resolveKickFollowMetadata(
      {
        getChannelsByBroadcasterIds: (ids) =>
          KickChannels.getChannelsByBroadcasterIds(kickTransport, ids),
        getChannelsBySlugs: (slugs) => KickChannels.getChannelsBySlugs(kickTransport, slugs),
        getPublicChannel: KickChannels.getPublicChannel,
      },
      follows
    );
    logger.info("Service:KickFollowMetadata", "Kick follow metadata refresh completed", {
      reason,
      followCount: follows.length,
      resolvedCount: resolvedChannels.size,
    });
  })();

  try {
    await inFlightRefresh;
  } finally {
    inFlightRefresh = null;
  }
}

export function startKickFollowMetadataRefresh(): void {
  if (refreshTimer) {
    return;
  }

  refreshTimer = createManagedInterval(
    () => {
      void refreshKickFollowMetadataNow("interval");
    },
    REFRESH_INTERVAL_MS,
    { unref: true }
  );
}

export function stopKickFollowMetadataRefresh(): void {
  if (!refreshTimer) {
    return;
  }

  refreshTimer.stop();
  refreshTimer = null;
}
