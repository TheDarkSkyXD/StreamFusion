import { twitchClient } from "@backend/api/platforms/twitch/twitch-client";
import {
  getTwitchEventSubClient,
  type TwitchEventSubClient,
} from "@backend/api/platforms/twitch/twitch-eventsub-client";
import type {
  NotificationPayload,
  TwitchEventSubEventType,
  TwitchEventSubSubscriptionFailure,
} from "@backend/api/platforms/twitch/twitch-eventsub-types";
import { twitchAuthService } from "@backend/auth";
import { TWITCH_OAUTH_CONFIG } from "@backend/auth/oauth-config";
import type { TwitchApiResult } from "@shared/twitch-api-types";

interface EventSubClientPort {
  readonly connectionState: string;
  subscribe<E>(
    eventType: TwitchEventSubEventType,
    channelId: string,
    listener: (payload: NotificationPayload<E>) => void,
    onSubscriptionFailure?: (failure: TwitchEventSubSubscriptionFailure) => void
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
  eventTypes?: readonly ("channel.moderate" | "automod.message.hold" | "automod.message.update")[];
  onEvent: (payload: unknown) => void;
  onState: (state: string) => void;
}

export interface TwitchEventSubFeedService {
  start(options: StartFeedOptions): Promise<TwitchApiResult<void>>;
  stop(feedId: string): void;
}

export function createTwitchEventSubFeedService(deps: FeedServiceDeps): TwitchEventSubFeedService {
  const cleanups = new Map<string, () => void>();
  const generations = new Map<string, number>();

  return {
    async start(options) {
      this.stop(options.feedId);
      const generation = (generations.get(options.feedId) ?? 0) + 1;
      generations.set(options.feedId, generation);
      const accessToken = await deps.getValidAccessToken();
      if (generations.get(options.feedId) !== generation)
        return { ok: false, error: { code: "unavailable", message: "EventSub feed was stopped." } };
      if (!accessToken) {
        return {
          ok: false,
          error: { code: "unauthorized", message: "Sign in to Twitch to use EventSub." },
        };
      }

      try {
        const client = deps.getClient(accessToken, options.userId);
        const eventTypes = options.eventTypes ?? ["channel.moderate"];
        const ownedEventTypes = new Set<TwitchEventSubEventType>(eventTypes);
        const unsubscribeEvents: Array<() => void> = [];
        let terminalState: "permission" | "error" | null = null;
        const onSubscriptionFailure = (failure: TwitchEventSubSubscriptionFailure) => {
          if (!ownedEventTypes.has(failure.eventType) || failure.channelId !== options.channelId) {
            return;
          }
          terminalState =
            failure.code === "unauthorized" || failure.code === "forbidden"
              ? "permission"
              : "error";
          options.onState(terminalState);
        };
        try {
          for (const eventType of eventTypes) {
            unsubscribeEvents.push(
              client.subscribe(eventType, options.channelId, options.onEvent, onSubscriptionFailure)
            );
          }
        } catch (error) {
          for (const unsubscribe of unsubscribeEvents) unsubscribe();
          throw error;
        }
        const unsubscribeState = client.onConnectionStateChange((state) => {
          if (!terminalState) options.onState(state);
        });
        if (!terminalState) options.onState(client.connectionState);
        if (generations.get(options.feedId) !== generation) {
          for (const unsubscribe of unsubscribeEvents) unsubscribe();
          unsubscribeState();
          return {
            ok: false,
            error: { code: "unavailable", message: "EventSub feed was stopped." },
          };
        }
        cleanups.set(options.feedId, () => {
          for (const unsubscribe of unsubscribeEvents) unsubscribe();
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
      generations.set(feedId, (generations.get(feedId) ?? 0) + 1);
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
