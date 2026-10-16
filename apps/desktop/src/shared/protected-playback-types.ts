export type ProtectedPlaybackFailure =
  "unsupported-platform" | "runtime-missing" | "host-start-failed";

export type ProtectedPlaybackOpenResult =
  { kind: "opened" } | { kind: "unavailable"; reason: ProtectedPlaybackFailure };

export type ProtectedPlaybackState =
  | { kind: "closed"; ownerId: string }
  | { kind: "failed"; ownerId: string; reason: ProtectedPlaybackFailure };

export interface ProtectedPlaybackOpenRequest {
  ownerId: string;
  channelSlug: string;
  muted: boolean;
}

export interface ProtectedPlaybackOwnerRequest {
  ownerId: string;
}

export interface ProtectedPlaybackMuteRequest extends ProtectedPlaybackOwnerRequest {
  muted: boolean;
}
