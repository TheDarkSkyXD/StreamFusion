export type ProfileFieldState<T> =
  | {
      state: "known";
      value: T;
      source: "official" | "first-party-fallback" | "chat-event";
    }
  | { state: "negative"; source: "official" | "first-party-fallback" }
  | { state: "reconnect-required"; missingScopes: string[] }
  | { state: "unavailable"; message: string }
  | { state: "failed"; message: string };

export type AccountCreatedFieldState = Exclude<ProfileFieldState<string>, { state: "negative" }>;

export interface PublicUserIdentity {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

export type TwitchPublicIdentity = PublicUserIdentity;
export type KickPublicIdentity = PublicUserIdentity;

export interface PublicResolvedChannel {
  id: string;
  username: string;
  displayName: string;
}

export type TwitchResolvedChannel = PublicResolvedChannel;
export type KickResolvedChannel = PublicResolvedChannel;
