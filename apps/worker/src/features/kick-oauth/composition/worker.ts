import { handleKickOAuthRequest } from "../routes/kick-oauth-router";
import type { RateLimiter } from "../capabilities/rate-limiter";

export interface KickOAuthEnvironment {
  readonly KICK_CLIENT_ID: string;
  readonly KICK_CLIENT_SECRET: string;
  readonly KICK_AUTH_IP_RATE_LIMITER: RateLimiter;
  readonly KICK_AUTH_SUBJECT_RATE_LIMITER: RateLimiter;
}

export default {
  fetch(request: Request, env: KickOAuthEnvironment): Promise<Response> {
    return handleKickOAuthRequest(request, { clientId: env.KICK_CLIENT_ID, clientSecret: env.KICK_CLIENT_SECRET, ipLimiter: env.KICK_AUTH_IP_RATE_LIMITER, subjectLimiter: env.KICK_AUTH_SUBJECT_RATE_LIMITER });
  }
};
