export type KickModerationErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "rate-limited"
  | "network"
  | "unknown";

export type KickModerationResult =
  | { ok: true }
  | { ok: false; kind: "rate-limited"; message: string; retryAfterSeconds: number | null }
  | {
      ok: false;
      kind: Exclude<KickModerationErrorKind, "rate-limited">;
      message: string;
    };

export interface KickOfficialModerationTarget {
  broadcasterUserId: number;
  userId: number;
  reason?: string;
}

export interface KickOfficialTimeoutTarget extends KickOfficialModerationTarget {
  /** Whole minutes, from 1 through 10,080. */
  duration: number;
}

export interface KickChatModeUpdate {
  slowMode?: { enabled: boolean; seconds?: number };
  followersOnly?: { enabled: boolean; minutes?: number };
  subscribersOnly?: { enabled: boolean };
  emoteOnly?: { enabled: boolean };
}

export interface KickChatModeRequest {
  channelSlug: string;
  update: KickChatModeUpdate;
}
