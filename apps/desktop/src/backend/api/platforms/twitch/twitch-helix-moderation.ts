/**
 * Twitch Helix moderation-channel discovery.
 *
 * Permission gates consume the discriminated result so authorization,
 * transport, malformed-response, and partial-pagination failures can never be
 * mistaken for a verified empty moderated-channel list.
 */

import { api } from "@/lib/api-client";
import { logger } from "@/lib/cross-logger";

const HELIX_BASE = "https://api.twitch.tv/helix";
const PAGE_CAP = 50;

export interface ModeratedChannel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
}

interface HelixModeratedChannelsResponse {
  data: ModeratedChannel[];
  pagination?: { cursor?: string };
}

export type ModeratedChannelsResult =
  | { state: "complete"; channels: ModeratedChannel[] }
  | {
      state: "partial" | "failed";
      reason: "authorization" | "network" | "invalid-response" | "page-cap";
      channels: ModeratedChannel[];
    };

function classifyError(error: unknown): "authorization" | "network" {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return status === 401 || status === 403 ? "authorization" : "network";
}

/**
 * Reads all pages from `GET /helix/moderation/channels`.
 *
 * Twitch does not include the broadcaster's own channel in this response.
 * Callers compare the authenticated user's id to the current broadcaster id
 * separately.
 */
export async function getModeratedChannelsResult(
  selfUserId: string,
  accessToken: string,
  clientId: string
): Promise<ModeratedChannelsResult> {
  const channels: ModeratedChannel[] = [];
  let cursor: string | undefined;
  const headers = {
    "Client-ID": clientId,
    Authorization: `Bearer ${accessToken}`,
  };

  for (let page = 0; page < PAGE_CAP; page++) {
    const url = `${HELIX_BASE}/moderation/channels?user_id=${encodeURIComponent(
      selfUserId
    )}&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;

    let body: HelixModeratedChannelsResponse | null;
    try {
      body = await api.get(url, { headers }).json<HelixModeratedChannelsResponse>();
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        logger.debug("Twitch:Helix:Mod", "getModeratedChannels failed", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
      }
      return {
        state: channels.length > 0 ? "partial" : "failed",
        reason: classifyError(error),
        channels,
      };
    }

    if (!body || !Array.isArray(body.data)) {
      return {
        state: channels.length > 0 ? "partial" : "failed",
        reason: "invalid-response",
        channels,
      };
    }

    channels.push(...body.data);
    cursor = body.pagination?.cursor;
    if (!cursor) return { state: "complete", channels };
  }

  return { state: "partial", reason: "page-cap", channels };
}

/**
 * Compatibility projection for callers that do not gate authority. New
 * permission surfaces must use `getModeratedChannelsResult`.
 */
export async function getModeratedChannels(
  selfUserId: string,
  accessToken: string,
  clientId: string
): Promise<ModeratedChannel[]> {
  return (await getModeratedChannelsResult(selfUserId, accessToken, clientId)).channels;
}
