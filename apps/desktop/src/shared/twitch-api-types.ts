export interface ResolvedTwitchChannel {
  id: string;
  login: string;
  displayName: string;
}

export interface ModeratedTwitchChannel {
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
}

export interface TwitchChatSettings {
  broadcaster_id: string;
  moderator_id?: string;
  slow_mode?: boolean;
  slow_mode_wait_time?: number | null;
  follower_mode?: boolean;
  follower_mode_duration?: number | null;
  subscriber_mode?: boolean;
  emote_mode?: boolean;
  unique_chat_mode?: boolean;
  non_moderator_chat_delay?: boolean;
  non_moderator_chat_delay_duration?: number | null;
}

export interface TwitchBannedUser {
  user_id: string;
  user_login: string;
  user_name: string;
  expires_at: string | "";
  created_at: string;
  reason: string;
  moderator_id: string;
  moderator_login: string;
  moderator_name: string;
}

export interface TwitchChannelMember {
  user_id: string;
  user_login: string;
  user_name: string;
}

export type TwitchUnbanRequestStatus =
  "pending" | "approved" | "denied" | "acknowledged" | "canceled";

export interface TwitchUnbanRequest {
  id: string;
  broadcaster_id: string;
  broadcaster_login: string;
  broadcaster_name: string;
  moderator_id: string | null;
  moderator_login: string | null;
  moderator_name: string | null;
  user_id: string;
  user_login: string;
  user_name: string;
  text: string;
  status: TwitchUnbanRequestStatus;
  created_at: string;
  resolved_at: string | null;
  resolution_text: string | null;
}

export interface TwitchPoll {
  id: string;
  title: string;
  choices: Array<{ id: string; title: string; votes: number }>;
  status: string;
  duration: number;
  started_at: string;
  ended_at: string | null;
  [key: string]: unknown;
}

export interface TwitchPrediction {
  id: string;
  title: string;
  outcomes: Array<{ id: string; title: string; users: number; channel_points: number }>;
  status: string;
  prediction_window: number;
  created_at: string;
  ended_at: string | null;
  locked_at: string | null;
  winning_outcome_id: string | null;
  [key: string]: unknown;
}

export interface TwitchChannelModerateEvent {
  broadcaster_user_id: string;
  moderator_user_id: string;
  moderator_user_login: string;
  moderator_user_name: string;
  action: string;
  delete?: {
    user_id: string;
    user_login: string;
    user_name: string;
    message_id: string;
    message_body: string;
  };
  [key: string]: unknown;
}

export interface TwitchChannelModeratePayload {
  metadata?: Record<string, unknown>;
  subscription: Record<string, unknown>;
  event: TwitchChannelModerateEvent;
}

export type TwitchApiCommand =
  | { operation: "resolve-channel"; login: string }
  | { operation: "get-global-emotes" }
  | { operation: "get-channel-emotes"; broadcasterId: string }
  | { operation: "get-emote-set"; emoteSetId: string }
  | { operation: "get-user-emotes"; userId: string; after?: string }
  | { operation: "get-users"; userIds: string[] }
  | { operation: "get-moderated-channels"; userId: string }
  | { operation: "get-chat-settings"; broadcasterId: string }
  | { operation: "get-banned-users"; broadcasterId: string; cursor?: string; userId?: string }
  | { operation: "get-moderators"; broadcasterId: string; userId?: string }
  | { operation: "get-vips"; broadcasterId: string }
  | {
      operation: "get-unban-requests";
      broadcasterId: string;
      moderatorId: string;
      status: "pending" | "approved" | "denied" | "acknowledged" | "canceled";
      userId?: string;
      after?: string;
    }
  | { operation: "get-polls"; broadcasterId: string }
  | { operation: "get-predictions"; broadcasterId: string }
  | {
      operation: "create-poll";
      broadcasterId: string;
      title: string;
      choices: string[];
      duration: number;
    }
  | {
      operation: "end-poll";
      broadcasterId: string;
      pollId: string;
      status: "TERMINATED" | "ARCHIVED";
    }
  | {
      operation: "create-prediction";
      broadcasterId: string;
      title: string;
      outcomes: string[];
      predictionWindow: number;
    }
  | {
      operation: "end-prediction";
      broadcasterId: string;
      predictionId: string;
      status: "LOCKED" | "RESOLVED" | "CANCELED";
      winningOutcomeId?: string;
    }
  | {
      operation: "ban-user";
      broadcasterId: string;
      moderatorId: string;
      userId: string;
      reason?: string;
    }
  | {
      operation: "warn-user";
      broadcasterId: string;
      moderatorId: string;
      userId: string;
      reason: string;
    }
  | { operation: "clear-chat"; broadcasterId: string; moderatorId: string }
  | {
      operation: "set-shield-mode";
      broadcasterId: string;
      moderatorId: string;
      active: boolean;
    }
  | { operation: "start-raid"; fromBroadcasterId: string; toBroadcasterId: string }
  | { operation: "run-commercial"; broadcasterId: string; length: 30 | 60 | 90 | 120 | 150 | 180 }
  | {
      operation: "pin-message" | "update-pin";
      broadcasterId: string;
      moderatorId: string;
      messageId: string;
      durationSeconds: number | null;
    }
  | {
      operation: "unpin-message";
      broadcasterId: string;
      moderatorId: string;
      messageId: string;
    }
  | {
      operation: "delete-chat-message";
      broadcasterId: string;
      moderatorId: string;
      messageId: string;
    }
  | {
      operation: "update-chat-settings";
      broadcasterId: string;
      moderatorId: string;
      settings: Omit<TwitchChatSettings, "broadcaster_id" | "moderator_id">;
    }
  | { operation: "unban-user"; broadcasterId: string; moderatorId: string; userId: string }
  | {
      operation: "add-moderator" | "remove-moderator" | "add-vip" | "remove-vip";
      broadcasterId: string;
      userId: string;
    }
  | {
      operation: "resolve-unban-request";
      broadcasterId: string;
      moderatorId: string;
      unbanRequestId: string;
      status: "approved" | "denied";
      resolutionText?: string;
    };

export type TwitchApiResult<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      kind?: string;
      error: { code: "unauthorized" | "invalid-input" | "unavailable"; message: string };
    };
