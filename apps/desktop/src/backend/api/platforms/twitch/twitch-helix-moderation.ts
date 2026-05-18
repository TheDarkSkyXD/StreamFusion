/**
 * Twitch Helix — Moderation
 *
 * Wrappers for Twitch's `/moderation/*` Helix endpoints. Used by the
 * mod-channels cache and (when scopes ship) the pin/unpin mod actions.
 *
 * Scope requirements:
 *   - `user:read:moderated_channels` for {@link getModeratedChannels}
 *
 * A 401 response (token lacks the required scope, or token is missing) is
 * treated as "no moderated channels" rather than an error — the lazy
 * re-consent dialog (U7) surfaces the scope-missing state at the action
 * boundary, not at hydration time.
 */

import { api } from "@/lib/api-client";

const HELIX_BASE = "https://api.twitch.tv/helix";

export interface ModeratedChannel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
}

interface HelixModeratedChannelsResponse {
  data: ModeratedChannel[];
  pagination?: { cursor?: string };
}

/**
 * Returns every Twitch channel the signed-in user moderates. Paginated;
 * follows the `pagination.cursor` until exhausted. Returns an empty array
 * when the token lacks `user:read:moderated_channels` (401) or when the
 * user moderates nothing.
 *
 * The broadcaster's OWN channel is NOT included by Twitch in this response —
 * the caller should treat `userId === self.broadcasterId` as mod-equivalent
 * separately. {@link useIsTwitchMod} handles that bridge.
 */
export async function getModeratedChannels(
  selfUserId: string,
  accessToken: string,
  clientId: string,
): Promise<ModeratedChannel[]> {
  const all: ModeratedChannel[] = [];
  let cursor: string | undefined;
  const headers = {
    "Client-ID": clientId,
    Authorization: `Bearer ${accessToken}`,
  };

  // Hard cap on pages so a Twitch hiccup can never spin forever. 50 pages
  // x 100/page is 5000 moderated channels — far past any realistic streamer.
  for (let page = 0; page < 50; page++) {
    const url = `${HELIX_BASE}/moderation/channels?user_id=${encodeURIComponent(
      selfUserId,
    )}&first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`;

    let body: HelixModeratedChannelsResponse | null;
    try {
      body = await api.get(url, { headers }).json<HelixModeratedChannelsResponse>();
    } catch (error) {
      // Token-side failures (401 / 403) are treated as "no moderated
      // channels" so the rest of the app keeps working. Network failures
      // also fall through — the next hydrate retry will pick up.
      if (process.env.NODE_ENV !== "production") {
        console.debug("[twitch-helix-moderation] getModeratedChannels failed:", error);
      }
      return all;
    }

    if (!body?.data) break;
    all.push(...body.data);
    cursor = body.pagination?.cursor;
    if (!cursor) break;
  }

  return all;
}
