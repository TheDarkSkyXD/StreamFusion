import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import {
  getTwitchEventSubClient,
  type TwitchEventSubClient,
} from "@/backend/api/platforms/twitch/twitch-eventsub-client";
import type { NotificationPayload } from "@/backend/api/platforms/twitch/twitch-eventsub-types";
import { twitchAuthService } from "@/backend/auth";
import { TWITCH_OAUTH_CONFIG } from "@/backend/auth/oauth-config";
import type { TwitchApiResult } from "@/shared/twitch-api-types";

interface EventSubClientPort {
  subscribe<E>(
    eventType: "channel.moderate",
    channelId: string,
    listener: (payload: NotificationPayload<E>) => void
  ): () => void;
  onConnectionStateChange(listener: (state: string) => void): () => void;
}

interface FeedServiceDeps {
  getValidAccessToken: () => Promise<string | null>;
  getClient: (accessToken: string, userId: string) => EventSubClientPort;
}

interface StartFeedOptions {
  feedId: string;
  userId: string;
  channelId: string;
  onEvent: (payload: unknown) => void;
  onState: (state: string) => void;
}

export interface TwitchEventSubFeedService {
  start(options: StartFeedOptions): Promise<TwitchApiResult<void>>;
  stop(feedId: string): void;
}

export function createTwitchEventSubFeedService(deps: FeedServiceDeps): TwitchEventSubFeedService {
  const cleanups = new Map<string, () => void>();

  return {
    async start(options) {
      this.stop(options.feedId);
      const accessToken = await deps.getValidAccessToken();
      if (!accessToken) {
        return {
          ok: false,
          error: { code: "unauthorized", message: "Sign in to Twitch to use EventSub." },
        };
      }

      try {
        const client = deps.getClient(accessToken, options.userId);
        const unsubscribeEvent = client.subscribe(
          "channel.moderate",
          options.channelId,
          options.onEvent
        );
        const unsubscribeState = client.onConnectionStateChange(options.onState);
        cleanups.set(options.feedId, () => {
          unsubscribeEvent();
          unsubscribeState();
        });
        return { ok: true, data: undefined };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: error instanceof Error ? error.message : "Twitch EventSub is unavailable.",
          },
        };
      }
    },

    stop(feedId) {
      cleanups.get(feedId)?.();
      cleanups.delete(feedId);
    },
  };
}

export const twitchEventSubFeedService = createTwitchEventSubFeedService({
  getValidAccessToken: () => twitchAuthService.getValidAccessToken(),
  getClient: (accessToken, userId): TwitchEventSubClient =>
    getTwitchEventSubClient(accessToken, userId, {
      clientId: TWITCH_OAUTH_CONFIG.clientId,
      tokenFetcher: () => twitchAuthService.getValidAccessToken(),
      subscriptionRequestor: twitchClient,
    }),
});
