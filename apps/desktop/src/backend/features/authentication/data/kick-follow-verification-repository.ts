import { dbService } from "@backend/services/database-service";

export type KickFollowVerificationEntry = {
  isVerified: boolean;
  verifiedAt: number;
};

type KickFollowVerificationCache = {
  version: 1;
  entries: Record<string, KickFollowVerificationEntry>;
  nextBackfillIndex: number;
};

const KICK_FOLLOW_VERIFICATION_CACHE_KEY = "kick-follow-verification-cache-v1";
const KICK_FOLLOW_VERIFICATION_CACHE_VERSION = 1;

let verificationCacheCommitTail: Promise<void> = Promise.resolve();

function emptyVerificationCache(): KickFollowVerificationCache {
  return {
    version: KICK_FOLLOW_VERIFICATION_CACHE_VERSION,
    entries: {},
    nextBackfillIndex: 0,
  };
}

function parseVerificationCache(candidate: unknown): KickFollowVerificationCache | null {
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !("version" in candidate) ||
    candidate.version !== KICK_FOLLOW_VERIFICATION_CACHE_VERSION ||
    !("entries" in candidate) ||
    !candidate.entries ||
    typeof candidate.entries !== "object"
  ) {
    return null;
  }

  const entries: Record<string, KickFollowVerificationEntry> = {};
  for (const [broadcasterId, entry] of Object.entries(candidate.entries)) {
    if (
      entry &&
      typeof entry === "object" &&
      "isVerified" in entry &&
      typeof entry.isVerified === "boolean" &&
      "verifiedAt" in entry &&
      typeof entry.verifiedAt === "number" &&
      Number.isFinite(entry.verifiedAt)
    ) {
      entries[broadcasterId] = {
        isVerified: entry.isVerified,
        verifiedAt: entry.verifiedAt,
      };
    }
  }

  const nextBackfillIndex =
    "nextBackfillIndex" in candidate &&
    typeof candidate.nextBackfillIndex === "number" &&
    Number.isSafeInteger(candidate.nextBackfillIndex) &&
    candidate.nextBackfillIndex >= 0
      ? candidate.nextBackfillIndex
      : 0;

  return {
    version: KICK_FOLLOW_VERIFICATION_CACHE_VERSION,
    entries,
    nextBackfillIndex,
  };
}

export function readVerificationCache(): KickFollowVerificationCache {
  return (
    dbService.get(KICK_FOLLOW_VERIFICATION_CACHE_KEY, parseVerificationCache) ??
    emptyVerificationCache()
  );
}

export async function commitVerificationCache(
  updates: ReadonlyMap<string, KickFollowVerificationEntry>,
  attemptedCount: number,
  rotationSize: number
): Promise<void> {
  if (attemptedCount === 0 && updates.size === 0) return;

  const commit = verificationCacheCommitTail
    .catch(() => undefined)
    .then(() => {
      const latest = readVerificationCache();

      for (const [broadcasterId, update] of updates) {
        const existing = latest.entries[broadcasterId];
        if (!existing || existing.verifiedAt <= update.verifiedAt) {
          latest.entries[broadcasterId] = update;
        }
      }

      latest.nextBackfillIndex =
        rotationSize > 0
          ? (latest.nextBackfillIndex + attemptedCount) % rotationSize
          : latest.nextBackfillIndex;
      dbService.set(KICK_FOLLOW_VERIFICATION_CACHE_KEY, latest);
    });

  verificationCacheCommitTail = commit.catch(() => undefined);
  await commit;
}
