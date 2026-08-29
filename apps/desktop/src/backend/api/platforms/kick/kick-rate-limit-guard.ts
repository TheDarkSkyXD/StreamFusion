import { storageService } from "@backend/services/storage-service";

const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 60 * 60_000;

type RateLimitStorage = Pick<
  typeof storageService,
  "clearKickApiRateLimitState" | "getKickApiRateLimitState" | "saveKickApiRateLimitState"
>;

export class KickRateLimitError extends Error {
  readonly status = 429;

  constructor(readonly retryAfterMs: number) {
    super(`Kick API rate limit active; retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = "KickRateLimitError";
  }
}

export class KickRateLimitGuard {
  constructor(
    private readonly storage: RateLimitStorage,
    private readonly now: () => number = Date.now
  ) {}

  assertRequestAllowed(): void {
    const state = this.storage.getKickApiRateLimitState();
    const currentTime = this.now();
    if (!state || !Number.isFinite(state.blockedUntil)) return;

    if (state.blockedUntil <= currentTime) {
      this.storage.clearKickApiRateLimitState();
      return;
    }

    throw new KickRateLimitError(state.blockedUntil - currentTime);
  }

  recordRateLimit(retryAfterHeader?: string): KickRateLimitError {
    const parsedSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
    const requestedMs = Number.isFinite(parsedSeconds) ? parsedSeconds * 1000 : DEFAULT_COOLDOWN_MS;
    const cooldownMs = Math.min(Math.max(requestedMs, DEFAULT_COOLDOWN_MS), MAX_COOLDOWN_MS);
    this.storage.saveKickApiRateLimitState({ blockedUntil: this.now() + cooldownMs });
    return new KickRateLimitError(cooldownMs);
  }
}

export const kickRateLimitGuard = new KickRateLimitGuard(storageService);
