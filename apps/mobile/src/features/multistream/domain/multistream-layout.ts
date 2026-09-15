import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";
import type {
  AddMultistreamSource,
  MultistreamLayout,
  MultistreamMode,
  MultistreamMutationResult,
  MultistreamSlot,
} from "../capabilities/multistream";
import {
  MAX_MULTISTREAM_SLOTS,
  slotIdFor,
} from "../capabilities/multistream";

export { emptyMultistreamLayout } from "../capabilities/multistream";

export function slotFromAddSource(source: AddMultistreamSource): MultistreamSlot {
  if (source.kind === "live") {
    return slotFromWatchTarget(source.target);
  }
  return {
    avatarUrl: source.avatarUrl ?? "",
    channelId: source.channelId,
    channelLogin: source.channelLogin,
    displayName: source.displayName,
    id: slotIdFor(source.platform, source.channelId),
    platform: source.platform,
    thumbnailUrl: source.thumbnailUrl ?? "",
    title: source.title ?? "",
  };
}

export function slotFromWatchTarget(target: WatchTarget): MultistreamSlot {
  return {
    avatarUrl: "",
    channelId: target.channelId,
    channelLogin: target.channelName,
    displayName: target.channelName,
    id: slotIdFor(target.platform, target.channelId),
    platform: target.platform,
    thumbnailUrl: target.media?.thumbnailUrl ?? "",
    title: target.media?.title ?? "",
  };
}

export function watchTargetFromSlot(slot: MultistreamSlot): WatchTarget {
  return {
    channelId: slot.channelId,
    channelName: slot.channelLogin,
    platform: slot.platform,
  };
}

export function addMultistreamSlot(
  layout: MultistreamLayout,
  slot: MultistreamSlot,
  updatedAt: number,
  slotCap: number = MAX_MULTISTREAM_SLOTS,
): MultistreamMutationResult {
  if (includesSlot(layout.slots, slot.id)) {
    return {
      detail: "That live channel is already in this Multistream room.",
      kind: "rejected",
    };
  }
  const cap = Math.min(
    MAX_MULTISTREAM_SLOTS,
    Math.max(1, Math.round(slotCap)),
  );
  if (layout.slots.length >= cap) {
    return {
      detail: `Multistream keeps at most ${cap} configured slots.`,
      kind: "rejected",
    };
  }
  const slots = [...layout.slots, slot];
  return {
    kind: "applied",
    layout: withOwners(
      {
        ...layout,
        slots,
        updatedAt,
      },
      layout.focusedSlotId ?? slot.id,
      layout.audioOwnerId ?? slot.id,
    ),
  };
}

export function removeMultistreamSlot(
  layout: MultistreamLayout,
  slotId: string,
  updatedAt: number,
): MultistreamLayout {
  const slots = layout.slots.filter((slot) => slot.id !== slotId);
  const nextFocus = includesSlot(slots, layout.focusedSlotId)
    ? layout.focusedSlotId
    : (slots[0]?.id ?? null);
  const nextAudio = includesSlot(slots, layout.audioOwnerId)
    ? layout.audioOwnerId
    : nextFocus;
  return withOwners(
    { ...layout, slots, updatedAt },
    nextFocus,
    nextAudio,
  );
}

export function reorderMultistreamSlot(
  layout: MultistreamLayout,
  slotId: string,
  direction: "down" | "up",
  updatedAt: number,
): MultistreamLayout {
  const index = layout.slots.findIndex((slot) => slot.id === slotId);
  if (index < 0) return layout;
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= layout.slots.length) return layout;
  const slots = [...layout.slots];
  const current = slots[index];
  const neighbor = slots[swapWith];
  if (!current || !neighbor) return layout;
  slots[index] = neighbor;
  slots[swapWith] = current;
  return { ...layout, slots, updatedAt };
}

export function setMultistreamAudioOwner(
  layout: MultistreamLayout,
  slotId: string,
  eligibleIds: ReadonlySet<string>,
  updatedAt: number,
): MultistreamMutationResult {
  if (!eligibleIds.has(slotId)) {
    return {
      detail: "Audio ownership needs an eligible active slot.",
      kind: "rejected",
    };
  }
  return {
    kind: "applied",
    layout: withOwners(layout, layout.focusedSlotId, slotId, updatedAt),
  };
}

export function setMultistreamFocus(
  layout: MultistreamLayout,
  slotId: string,
  updatedAt: number,
): MultistreamLayout {
  if (!includesSlot(layout.slots, slotId)) return layout;
  return withOwners(layout, slotId, layout.audioOwnerId, updatedAt);
}

export function setMultistreamMode(
  layout: MultistreamLayout,
  mode: MultistreamMode,
  updatedAt: number,
): MultistreamLayout {
  return { ...layout, mode, updatedAt };
}

function includesSlot(
  slots: readonly MultistreamSlot[],
  slotId: string | null,
): boolean {
  return slotId !== null && slots.some((slot) => slot.id === slotId);
}

function withOwners(
  layout: MultistreamLayout,
  focusedSlotId: string | null,
  audioOwnerId: string | null,
  updatedAt = layout.updatedAt,
): MultistreamLayout {
  return {
    ...layout,
    audioOwnerId,
    focusedSlotId,
    updatedAt,
  };
}
