import type { Platform } from "@streamfusion/core/platform";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

export const MAX_MULTISTREAM_SLOTS = 6;
export const MULTISTREAM_LAYOUT_ROW_ID = "current";

export type MultistreamMode = "focus" | "grid";

export type MultistreamSlotPhase =
  | "empty"
  | "retained"
  | "thumbnail"
  | "paused"
  | "active";

export interface MultistreamSlot {
  readonly avatarUrl: string;
  readonly channelId: string;
  readonly channelLogin: string;
  readonly displayName: string;
  readonly id: string;
  readonly platform: Platform;
  readonly thumbnailUrl: string;
  readonly title: string;
}

export interface MultistreamLayout {
  readonly audioOwnerId: string | null;
  readonly focusedSlotId: string | null;
  readonly mode: MultistreamMode;
  readonly slots: readonly MultistreamSlot[];
  readonly updatedAt: number;
}

export interface MultistreamRepository {
  read(): Promise<MultistreamLayout | null>;
  write(layout: MultistreamLayout): Promise<void>;
}

export type MultistreamMutationResult =
  | { readonly kind: "applied"; readonly layout: MultistreamLayout }
  | { readonly detail: string; readonly kind: "rejected" };

export interface ActiveVideoAdmission {
  readonly limit: number;
  readonly reason: string;
}

export interface QualifiedMultistream {
  readonly activeSlotIds: readonly string[];
  readonly admission: ActiveVideoAdmission;
  readonly layout: MultistreamLayout;
  readonly notice: string | null;
  readonly pausedSlotIds: readonly string[];
  readonly thumbnailSlotIds: readonly string[];
}

export type AddMultistreamSource =
  | { readonly kind: "live"; readonly target: WatchTarget }
  | {
      readonly avatarUrl?: string;
      readonly channelId: string;
      readonly channelLogin: string;
      readonly displayName: string;
      readonly kind: "channel";
      readonly platform: Platform;
      readonly thumbnailUrl?: string;
      readonly title?: string;
    };

export function multistreamSessionId(slotId: string): string {
  return `multi:${slotId}`;
}

export function slotIdFor(platform: Platform, channelId: string): string {
  return `${platform}:${channelId}`;
}

export function emptyMultistreamLayout(updatedAt = 0): MultistreamLayout {
  return {
    audioOwnerId: null,
    focusedSlotId: null,
    mode: "grid",
    slots: [],
    updatedAt,
  };
}
