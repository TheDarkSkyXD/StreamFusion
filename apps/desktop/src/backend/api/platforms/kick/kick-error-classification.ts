export function isKickRequestCancellation(message: string): boolean {
  return /(?:net::)?ERR_ABORTED/i.test(message);
}

export function isKickNetworkFailure(message: string): boolean {
  return /net::ERR_/i.test(message) && !isKickRequestCancellation(message);
}

export function isKickRateLimitError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      name?: unknown;
      status?: unknown;
      statusCode?: unknown;
      response?: { status?: unknown };
    };
    if (
      candidate.name === "KickRateLimitError" ||
      candidate.status === 429 ||
      candidate.statusCode === 429 ||
      candidate.response?.status === 429
    ) {
      return true;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return /(?:\b429\b|rate[ -]?limit)/i.test(message);
}
