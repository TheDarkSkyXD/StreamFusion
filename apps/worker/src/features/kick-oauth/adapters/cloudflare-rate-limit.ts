import type { RateLimiter } from "../capabilities/rate-limiter";
import { sha256Hex } from "../utils/sha256";

export type RateLimitResult = "allowed" | "denied" | "unavailable";
export async function enforceKickAuthIpLimit(request: Request, limiter: RateLimiter | undefined): Promise<RateLimitResult> { return enforceLimit(limiter, `kick-auth:ip:${request.headers.get("CF-Connecting-IP") || "missing"}`); }
export async function enforceKickAuthSubjectLimit(subject: string, limiter: RateLimiter | undefined): Promise<RateLimitResult> { return enforceLimit(limiter, `kick-auth:subject:${await sha256Hex(subject)}`); }
async function enforceLimit(limiter: RateLimiter | undefined, key: string): Promise<RateLimitResult> {
  try { const outcome = await limiter?.limit({ key }); if (!outcome) return "unavailable"; return outcome.success ? "allowed" : "denied"; } catch { return "unavailable"; }
}
