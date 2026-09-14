import type { Platform } from "@streamfusion/core/platform";

import type { WatchInspection, WatchTarget } from "@mobile/features/watch/capabilities/watch";

export const MAX_WATCH_HISTORY_ITEMS = 200;

export type WatchHistoryKind = "clip" | "stream" | "video";

export type WatchHistoryItem = {
  readonly avatarUrl: string;
  readonly channelDisplayName: string;
  readonly channelId: string;
  readonly channelLogin: string;
  readonly contentId: string;
  readonly durationSeconds: number;
  readonly id: string;
  readonly kind: WatchHistoryKind;
  readonly platform: Platform;
  readonly positionSeconds: number;
  readonly thumbnailUrl: string;
  readonly title: string;
  readonly updatedAt: number;
};

export type WatchHistoryOpenMode = "open" | "replay" | "resume";

export interface WatchHistoryRepository {
  clear(): Promise<void>;
  list(): Promise<readonly WatchHistoryItem[]>;
  remove(id: string): Promise<void>;
  upsert(item: WatchHistoryItem): Promise<void>;
}

export type WatchHistoryCapture = {
  readonly inspection: WatchInspection | null;
  readonly positionSeconds: number;
  readonly target: WatchTarget;
  readonly updatedAt: number;
};
