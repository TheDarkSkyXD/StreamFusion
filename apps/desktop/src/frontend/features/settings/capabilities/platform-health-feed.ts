import type {
  PlatformHealth,
  PlatformHealthEvent,
  StatusPageDetail,
} from "@shared/platform-health-types";

export interface PlatformHealthSnapshot {
  kick: PlatformHealth;
  twitch: PlatformHealth;
  details?: { kick?: StatusPageDetail; twitch?: StatusPageDetail };
}

export interface PlatformHealthFeed {
  get(): Promise<PlatformHealthSnapshot>;
  onChange(callback: (event: PlatformHealthEvent) => void): () => void;
}
