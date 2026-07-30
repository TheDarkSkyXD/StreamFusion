export type ProfileFieldState<T> =
  | { state: "known"; value: T; source: "official" | "first-party-fallback" }
  | { state: "negative"; source: "official" | "first-party-fallback" }
  | { state: "reconnect-required"; missingScopes: string[] }
  | { state: "unavailable"; message: string }
  | { state: "failed"; message: string };

export interface TwitchPublicIdentity {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export interface TwitchResolvedChannel {
  id: string;
  username: string;
  displayName: string;
}

export interface TwitchIdentityRequest {
  userId: string;
  username: string;
}

export interface TwitchFollowRequest {
  broadcasterId: string;
  userId: string;
  username: string;
}

export interface TwitchChannelRequest {
  username: string;
}

export type TwitchAccountCreatedRequest = TwitchIdentityRequest;
