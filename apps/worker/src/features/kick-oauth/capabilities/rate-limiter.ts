export interface RateLimitOutcome {
  readonly success: boolean;
}

export interface RateLimiter {
  limit(input: { readonly key: string }): Promise<RateLimitOutcome>;
}
