import type { StoreDatabase } from "@mobile/features/storage/data/database-contracts";

import type {
  MultistreamLayout,
  MultistreamRepository,
  MultistreamSlot,
} from "../capabilities/multistream";
import {
  emptyMultistreamLayout,
  MULTISTREAM_LAYOUT_ROW_ID,
} from "../capabilities/multistream";

interface LayoutRow {
  readonly payload: string;
  readonly updated_at: number;
}

export function createProductMultistreamStore(
  database: StoreDatabase,
): MultistreamRepository {
  return {
    async read() {
      const row = await database.first<LayoutRow>(
        "SELECT payload, updated_at FROM multistream_layout WHERE id = ?",
        [MULTISTREAM_LAYOUT_ROW_ID],
      );
      if (!row) return null;
      return layoutFromPayload(row.payload, row.updated_at);
    },
    async write(layout) {
      await database.run(
        `INSERT INTO multistream_layout (id, payload, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`,
        [MULTISTREAM_LAYOUT_ROW_ID, JSON.stringify(layout), layout.updatedAt],
      );
    },
  };
}

function layoutFromPayload(
  payload: string,
  updatedAt: number,
): MultistreamLayout | null {
  try {
    const parsed = JSON.parse(payload) as Partial<MultistreamLayout>;
    if (!Array.isArray(parsed.slots)) return emptyMultistreamLayout(updatedAt);
    const slots = parsed.slots.flatMap((slot) => {
      const item = slotFromUnknown(slot);
      return item ? [item] : [];
    });
    const mode = parsed.mode === "focus" ? "focus" : "grid";
    const focusedSlotId = ownedSlotId(slots, parsed.focusedSlotId) ?? slots[0]?.id ?? null;
    const audioOwnerId = ownedSlotId(slots, parsed.audioOwnerId) ?? focusedSlotId;
    return {
      audioOwnerId,
      focusedSlotId,
      mode,
      slots,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : updatedAt,
    };
  } catch {
    return emptyMultistreamLayout(updatedAt);
  }
}

function slotFromUnknown(value: unknown): MultistreamSlot | null {
  if (!value || typeof value !== "object") return null;
  const slot = value as Partial<MultistreamSlot>;
  if (
    typeof slot.id !== "string" ||
    (slot.platform !== "twitch" && slot.platform !== "kick") ||
    typeof slot.channelId !== "string" ||
    typeof slot.channelLogin !== "string" ||
    typeof slot.displayName !== "string"
  ) {
    return null;
  }
  return {
    avatarUrl: typeof slot.avatarUrl === "string" ? slot.avatarUrl : "",
    channelId: slot.channelId,
    channelLogin: slot.channelLogin,
    displayName: slot.displayName,
    id: slot.id,
    platform: slot.platform,
    thumbnailUrl: typeof slot.thumbnailUrl === "string" ? slot.thumbnailUrl : "",
    title: typeof slot.title === "string" ? slot.title : "",
  };
}

function ownedSlotId(
  slots: readonly MultistreamSlot[],
  value: unknown,
): string | null {
  return typeof value === "string" && slots.some((slot) => slot.id === value)
    ? value
    : null;
}
