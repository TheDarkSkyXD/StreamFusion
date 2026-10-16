import type {
  ProtectedPlaybackOpenRequest,
  ProtectedPlaybackOpenResult,
  ProtectedPlaybackState,
} from "@shared/protected-playback-types";

export interface ProtectedPlaybackController {
  isAvailable(): boolean;
  check(channelSlug: string): Promise<boolean>;
  open(request: ProtectedPlaybackOpenRequest): Promise<ProtectedPlaybackOpenResult>;
  focus(ownerId: string): Promise<void>;
  close(ownerId: string): Promise<void>;
  mute(ownerId: string, muted: boolean): Promise<void>;
  onState(callback: (state: ProtectedPlaybackState) => void): () => void;
  installRuntime(): Promise<void>;
}
