export type ProtectedPlaybackFailure =
  "unsupported-platform" | "runtime-missing" | "host-start-failed";

export type ProtectedPlaybackOpenResult =
  { kind: "opened" } | { kind: "unavailable"; reason: ProtectedPlaybackFailure };

export type ProtectedPlaybackState =
  | { kind: "closed"; ownerId: string }
  | { kind: "failed"; ownerId: string; reason: ProtectedPlaybackFailure }
  | { kind: "volume"; ownerId: string; volume: number; muted: boolean }
  | {
      kind: "action";
      ownerId: string;
      action: "expand" | "close" | "theater" | "back" | "forward" | "tab-next" | "tab-previous";
    }
  | { kind: "drag"; ownerId: string; dx: number; dy: number }
  | { kind: "fullscreen"; ownerId: string; active: boolean };

export interface ProtectedPlaybackRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ProtectedPlaybackLayout =
  | { kind: "hidden" }
  | {
      kind: "visible";
      boundsCss: ProtectedPlaybackRect;
      clipCss: ProtectedPlaybackRect;
      radiusCss: number;
    };

export interface ProtectedPlaybackPresentRequest extends ProtectedPlaybackOwnerRequest {
  revision: number;
  layout: ProtectedPlaybackLayout;
  presentation: "docked" | "theater" | "mini";
  blockerEnabled: boolean;
}

export interface ProtectedPlaybackOpenRequest {
  ownerId: string;
  channelSlug: string;
  muted: boolean;
  volume?: number;
  blockerEnabled?: boolean;
  forcedMuted?: boolean;
}

export interface ProtectedPlaybackOwnerRequest {
  ownerId: string;
}

export interface ProtectedPlaybackMuteRequest extends ProtectedPlaybackOwnerRequest {
  muted: boolean;
}
import type { UserPreferences } from "./auth-types";

export type ProtectedPlayerPreferences = Pick<
  UserPreferences,
  "language" | "playback" | "playerControls" | "buffer" | "playbackAdvanced" | "captions"
>;

export interface ProtectedPlayerBootstrap {
  channelSlug: string;
  masterUrl: string;
  preferences: ProtectedPlayerPreferences;
  blockerEnabled: boolean;
  volume: number;
  muted: boolean;
}
