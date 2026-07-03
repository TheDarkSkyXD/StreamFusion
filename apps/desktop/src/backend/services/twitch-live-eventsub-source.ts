import type {
  getTwitchEventSubClient,
  TwitchEventSubClient,
} from "@/backend/api/platforms/twitch/twitch-eventsub-client";
import type {
  NotificationPayload,
  StreamOfflineEvent,
  StreamOnlineEvent,
  TwitchEventSubConnectionState,
} from "@/backend/api/platforms/twitch/twitch-eventsub-types";
import type { AuthToken, LocalFollow, TwitchUser } from "@/shared/auth-types";

import type { LiveNotificationObservation } from "./live-notification-service";

export interface TwitchLiveEventSubCoverageIssue {
  platform: "twitch";
  reason: "subscription-failed" | "connection-error";
  channelId?: string;
  message?: string;
}

export interface TwitchLiveEventSubSourceDeps {
  getToken: () => AuthToken | null;
  getUser: () => TwitchUser | null;
  getFollows: () => LocalFollow[];
  getClientId?: () => string | null;
  getEventSubClient: typeof getTwitchEventSubClient;
  onOnline: (observation: LiveNotificationObservation) => void;
  onOffline: (
    channel: Pick<LiveNotificationObservation, "platform" | "channelId" | "channelName">
  ) => void;
  onCoverageDegraded?: (issue: TwitchLiveEventSubCoverageIssue) => void;
}

interface LiveEventSubSubscription {
  unsubscribeOnline: () => void;
  unsubscribeOffline: () => void;
}

export class TwitchLiveEventSubSource {
  private client: TwitchEventSubClient | null = null;
  private clientKey: string | null = null;
  private connectionCleanup: (() => void) | null = null;
  private readonly subscriptions = new Map<string, LiveEventSubSubscription>();

  constructor(private readonly deps: TwitchLiveEventSubSourceDeps) {}

  sync(): void {
    const token = this.deps.getToken();
    const user = this.deps.getUser();
    if (!token?.accessToken || !user?.id) {
      this.teardown();
      return;
    }

    const clientId = this.deps.getClientId?.() ?? null;
    const nextClientKey = `${token.accessToken}:${user.id}:${clientId ?? ""}`;
    if (this.clientKey !== nextClientKey) {
      this.teardown();
      try {
        this.client = this.deps.getEventSubClient(
          token.accessToken,
          user.id,
          clientId ? { clientId } : undefined
        );
      } catch (err) {
        this.deps.onCoverageDegraded?.({
          platform: "twitch",
          reason: "subscription-failed",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      this.clientKey = nextClientKey;
      this.connectionCleanup = this.client.onConnectionStateChange((state) => {
        this.handleConnectionState(state);
      });
    }

    const desiredFollows = this.deps
      .getFollows()
      .filter((follow) => follow.platform === "twitch" && follow.source === "twitch");
    const desiredChannelIds = new Set(desiredFollows.map((follow) => follow.channelId));

    for (const [channelId, subscription] of this.subscriptions) {
      if (!desiredChannelIds.has(channelId)) {
        subscription.unsubscribeOnline();
        subscription.unsubscribeOffline();
        this.subscriptions.delete(channelId);
      }
    }

    for (const follow of desiredFollows) {
      if (!follow.channelId || this.subscriptions.has(follow.channelId)) continue;
      this.subscribeFollow(follow);
    }
  }

  close(): void {
    this.teardown();
  }

  private subscribeFollow(follow: LocalFollow): void {
    if (!this.client) return;

    let unsubscribeOnline: (() => void) | null = null;
    try {
      unsubscribeOnline = this.client.subscribe<StreamOnlineEvent>(
        "stream.online",
        follow.channelId,
        (payload) => {
          this.deps.onOnline(this.toOnlineObservation(payload, follow));
        }
      );
      const unsubscribeOffline = this.client.subscribe<StreamOfflineEvent>(
        "stream.offline",
        follow.channelId,
        (payload) => {
          this.deps.onOffline(this.toOfflineObservation(payload, follow));
        }
      );
      this.subscriptions.set(follow.channelId, {
        unsubscribeOnline,
        unsubscribeOffline,
      });
    } catch (err) {
      unsubscribeOnline?.();
      this.deps.onCoverageDegraded?.({
        platform: "twitch",
        reason: "subscription-failed",
        channelId: follow.channelId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private toOnlineObservation(
    payload: NotificationPayload<StreamOnlineEvent>,
    follow: LocalFollow
  ): LiveNotificationObservation {
    const event = payload.event;
    return {
      platform: "twitch",
      channelId: event.broadcaster_user_id || follow.channelId,
      channelName: event.broadcaster_user_login || follow.channelName,
      channelDisplayName: event.broadcaster_user_name || follow.displayName,
      channelAvatar: follow.profileImage,
      title: "Live now",
    };
  }

  private toOfflineObservation(
    payload: NotificationPayload<StreamOfflineEvent>,
    follow: LocalFollow
  ): Pick<LiveNotificationObservation, "platform" | "channelId" | "channelName"> {
    const event = payload.event;
    return {
      platform: "twitch",
      channelId: event.broadcaster_user_id || follow.channelId,
      channelName: event.broadcaster_user_login || follow.channelName,
    };
  }

  private handleConnectionState(state: TwitchEventSubConnectionState): void {
    if (state !== "error") return;
    this.deps.onCoverageDegraded?.({
      platform: "twitch",
      reason: "connection-error",
    });
  }

  private teardown(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.unsubscribeOnline();
      subscription.unsubscribeOffline();
    }
    this.subscriptions.clear();
    this.connectionCleanup?.();
    this.connectionCleanup = null;
    this.clientKey = null;
    this.client?.close();
    this.client = null;
  }
}
