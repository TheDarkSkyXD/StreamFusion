import {
  fetchKickWebApiGet,
  isKickWebApiReady,
} from "@/backend/api/platforms/kick/kick-send-window";
import { logger } from "@/backend/logging/logger";

/**
 * Legacy/internal Kick web endpoint.
 *
 * Kick's public API does not currently expose the signed-in user's subscribed
 * channel emote inventory. This call intentionally runs from the hidden
 * kick.com web session so the site's own cookies and Sanctum bearer attach.
 */
export async function fetchKickUserSubscriptions(): Promise<unknown | null> {
  if (!(await isKickWebApiReady())) return null;

  let result: Awaited<ReturnType<typeof fetchKickWebApiGet>>;
  try {
    result = await fetchKickWebApiGet("/api/v2/user/subscriptions");
  } catch (error) {
    logger.info("Emote:Kick", "Kick user subscription emotes unavailable", {
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
    return null;
  }

  if (!result.ok) {
    logger.info("Emote:Kick", "User subscription emotes unavailable via Kick web session", {
      kind: result.kind,
      status: result.status,
      message: result.message,
    });
    return null;
  }

  try {
    return JSON.parse(result.body) as unknown;
  } catch (error) {
    logger.warn("Emote:Kick", "Kick user subscriptions returned non-JSON response", {
      status: result.status,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    return null;
  }
}
