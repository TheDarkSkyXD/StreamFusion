import { dbService } from "@backend/services/database-service";
interface KickApiRateLimitState {
  blockedUntil: number;
}

const OPERATIONAL_KEYS = {
  kickApiRateLimit: "operational:kickApiRateLimit",
};

class KickContinuityRepository {
  // ========== Kick API continuity (SQLite) ==========

  getKickApiRateLimitState(): KickApiRateLimitState | undefined {
    return (
      dbService.get(OPERATIONAL_KEYS.kickApiRateLimit, (value) => {
        if (
          typeof value === "object" &&
          value !== null &&
          "blockedUntil" in value &&
          typeof value.blockedUntil === "number"
        ) {
          return { blockedUntil: value.blockedUntil };
        }
        return null;
      }) ?? undefined
    );
  }

  saveKickApiRateLimitState(state: KickApiRateLimitState): void {
    dbService.set(OPERATIONAL_KEYS.kickApiRateLimit, state);
  }

  clearKickApiRateLimitState(): void {
    dbService.delete(OPERATIONAL_KEYS.kickApiRateLimit);
  }
}
export const kickContinuityRepository = new KickContinuityRepository();
