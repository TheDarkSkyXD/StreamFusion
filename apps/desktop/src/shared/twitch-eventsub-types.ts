/** Process-neutral EventSub shapes used by moderation event consumers. */
export type TwitchEventSubEventType =
  | "channel.moderate"
  | "automod.message.hold"
  | "automod.message.update"
  | "stream.online"
  | "stream.offline";

export interface NotificationPayload<E = unknown> {
  metadata?: {
    message_id: string;
    message_type: string;
    message_timestamp: string;
    subscription_type?: string;
    subscription_version?: string;
  };
  subscription: {
    id: string;
    type: TwitchEventSubEventType;
    version: string;
    status: string;
    cost: number;
    condition: Record<string, unknown>;
    transport: { method: "websocket"; session_id: string };
    created_at: string;
  };
  event: E;
}

export interface ChannelModerateEvent {
  broadcaster_user_id: string;
  broadcaster_user_login: string;
  broadcaster_user_name: string;
  moderator_user_id: string;
  moderator_user_login: string;
  moderator_user_name: string;
  action: string;
  ban?: { user_id: string; user_login: string; user_name: string; reason: string | null };
  timeout?: {
    user_id: string;
    user_login: string;
    user_name: string;
    reason: string | null;
    expires_at: string;
  };
  delete?: {
    user_id: string;
    user_login: string;
    user_name: string;
    message_id: string;
    message_body: string;
  };
  [extra: string]: unknown;
}
