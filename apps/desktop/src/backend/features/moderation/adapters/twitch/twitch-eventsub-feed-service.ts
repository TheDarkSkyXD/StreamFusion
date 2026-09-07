import { twitchTransport } from "@backend/api/platforms/twitch/twitch-transport";
import {
  getTwitchEventSubClient,
  type TwitchEventSubClient,
} from "@backend/api/platforms/twitch/twitch-eventsub-client";
import type {
  NotificationPayload,
  TwitchEventSubEventType,
  TwitchEventSubSubscriptionFailure,
} from "@backend/api/platforms/twitch/twitch-eventsub-types";
import { TWITCH_EVENTSUB_CATALOG } from "@backend/api/platforms/twitch/twitch-eventsub-catalog";
import { twitchAuthService } from "@backend/features/authentication/adapters/twitch/twitch-auth";
import { TWITCH_OAUTH_CONFIG } from "@backend/features/authentication/adapters/oauth/oauth-config";
import type { TwitchApiResult } from "@shared/twitch-api-types";
import { MODERATION_FEED_EVENT_TYPES, type ModerationEventSubType } from "@shared/moderation-types";
import {
  acquireModerationAccountLease,
  type ModerationAccountLease,
} from "./moderation-account-lease";
import { normalizeModerationFeedEvent } from "./moderation-feed-normalizer";

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
  acquireLease: () => Promise<ModerationAccountLease | null>;
  getClient: (accessToken: string, userId: string) => EventSubClientPort;
}
interface StartFeedOptions {
  feedId: string;
  userId: string;
  channelId: string;
  eventTypes?: readonly ModerationEventSubType[];
  onEvent: (payload: unknown) => void;
  onState: (state: string) => void;
}
export interface TwitchEventSubFeedService {
  start(options: StartFeedOptions): Promise<TwitchApiResult<void>>;
  stop(feedId: string): void;
}
const newEvents = new Set<string>(MODERATION_FEED_EVENT_TYPES);
const MAX_FEEDS = 64;
const MAX_RECENT_EVENT_IDS = 512;

export function createTwitchEventSubFeedService(deps: FeedServiceDeps): TwitchEventSubFeedService {
  const feeds = new Map<string, { cleanup: () => void }>();
  const service: TwitchEventSubFeedService = {
    async start(options) {
      service.stop(options.feedId);
      if (feeds.size >= MAX_FEEDS)
        return {
          ok: false,
          error: { code: "unavailable", message: "Too many active EventSub feeds." },
        };
      const pending = { cleanup: () => {} };
      feeds.set(options.feedId, pending);
      const current = () => feeds.get(options.feedId) === pending;
      let lease: ModerationAccountLease | null;
      try {
        lease = await deps.acquireLease();
      } catch {
        lease = null;
      }
      if (!current())
        return { ok: false, error: { code: "unavailable", message: "EventSub feed was stopped." } };
      if (!lease || !lease.isCurrent() || lease.userId !== options.userId) {
        service.stop(options.feedId);
        return {
          ok: false,
          error: {
            code: "unauthorized",
            message: "Sign in to the matching Twitch account to use EventSub.",
          },
        };
      }
      const account = lease;
      const eventTypes: ModerationEventSubType[] = [
        ...new Set<ModerationEventSubType>(options.eventTypes ?? ["channel.moderate"]),
      ];
      for (const type of eventTypes) {
        const spec = TWITCH_EVENTSUB_CATALOG[type];
        if (spec.actor === "broadcaster" && options.channelId !== account.userId) {
          service.stop(options.feedId);
          return {
            ok: false,
            error: { code: "forbidden", message: `${type} requires the broadcaster account.` },
          };
        }
        if (spec.scopes.some((group) => !group.some((scope) => account.scopes.includes(scope)))) {
          service.stop(options.feedId);
          return {
            ok: false,
            error: {
              code: "missing-scope",
              message: `Reconnect Twitch with the permissions for ${type}.`,
            },
          };
        }
      }
      const coverageStartedAt = new Date().toISOString();
      const cleanups: Array<() => void> = [];
      const seen = new Set<string>();
      const addCleanup = (cleanup: () => void) => {
        if (current()) cleanups.push(cleanup);
        else cleanup();
      };
      pending.cleanup = () => {
        for (const cleanup of cleanups.splice(0)) cleanup();
        seen.clear();
      };
      const checkAccount = () => {
        if (!current()) return false;
        if (account.isCurrent()) return true;
        service.stop(options.feedId);
        options.onState("permission");
        return false;
      };
      try {
        const client = deps.getClient(account.accessToken, account.userId);
        let terminalState: "permission" | "error" | null = null;
        const failure = (event: TwitchEventSubSubscriptionFailure) => {
          if (!checkAccount()) return;
          terminalState =
            event.code === "unauthorized" || event.code === "forbidden" ? "permission" : "error";
          options.onState(terminalState);
        };
        for (const type of eventTypes) {
          const routingId = type === "user.whisper.message" ? account.userId : options.channelId;
          addCleanup(
            client.subscribe(
              type,
              routingId,
              (payload) => {
                if (!checkAccount()) return;
                const id = payload.metadata?.message_id;
                if (id && seen.has(id)) return;
                const normalized = newEvents.has(type)
                  ? normalizeModerationFeedEvent(payload, {
                      accountId: account.userId,
                      channelId: options.channelId,
                      coverageStartedAt,
                    })
                  : payload;
                if (!normalized) return;
                if (id) {
                  seen.add(id);
                  if (seen.size > MAX_RECENT_EVENT_IDS) {
                    const oldest = seen.values().next().value;
                    if (oldest !== undefined) seen.delete(oldest);
                  }
                }
                options.onEvent(normalized);
              },
              failure
            )
          );
        }
        addCleanup(
          account.onCredentialsChanged(() => {
            if (!current() || account.isCurrent()) return;
            // Revalidate a rotated grant before restoring this same account/channel lease.
            void service.start(options).then((result) => {
              if (!result.ok) options.onState("permission");
            });
          })
        );
        addCleanup(
          client.onConnectionStateChange((state) => {
            if (checkAccount() && !terminalState) options.onState(state);
          })
        );
        if (!checkAccount())
          return {
            ok: false,
            error: { code: "unauthorized", message: "The Twitch account changed." },
          };
        if (!terminalState) options.onState(client.connectionState);
        return { ok: true, data: undefined };
      } catch (error) {
        service.stop(options.feedId);
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
      const feed = feeds.get(feedId);
      feeds.delete(feedId);
      feed?.cleanup();
    },
  };
  return service;
}

export const twitchEventSubFeedService = createTwitchEventSubFeedService({
  acquireLease: acquireModerationAccountLease,
  getClient: (accessToken, userId): TwitchEventSubClient =>
    getTwitchEventSubClient(accessToken, userId, {
      clientId: TWITCH_OAUTH_CONFIG.clientId,
      tokenFetcher: () => twitchAuthService.getValidAccessToken(),
      subscriptionRequestor: twitchTransport,
    }),
});
