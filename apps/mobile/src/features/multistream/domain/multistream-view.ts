import {
  MAX_MULTISTREAM_SLOTS,
  multistreamSessionId,
  type MultistreamMode,
  type MultistreamSlot,
  type MultistreamSlotPhase,
  type QualifiedMultistream,
} from "../capabilities/multistream";

export type MultistreamCell =
  | {
      readonly kind: "empty";
      readonly index: number;
    }
  | {
      readonly audioOwner: boolean;
      readonly focused: boolean;
      readonly index: number;
      readonly kind: "configured";
      readonly phase: MultistreamSlotPhase;
      readonly sessionId: string | null;
      readonly slot: MultistreamSlot;
    };

export type MultistreamConfirm =
  | { readonly kind: "idle" }
  | { readonly kind: "remove"; readonly slotId: string }
  | { readonly kind: "clear" };

export type MultistreamView = {
  readonly activeCount: number;
  readonly captionDetail: string;
  readonly cells: readonly MultistreamCell[];
  readonly chatDetail: string;
  readonly configuredCount: number;
  readonly confirm: MultistreamConfirm;
  readonly editing: boolean;
  readonly mode: MultistreamMode;
  readonly notice: string | null;
  readonly title: string;
};

export const MULTISTREAM_CHAT_DETAIL =
  "Select a live slot to connect guest chat over Twitch IRC or Kick Pusher.";

export const MULTISTREAM_CAPTION_DETAIL =
  "Captions stay on the focused Watch player. Multistream does not overlay a second caption session.";

export function composeMultistreamView(input: {
  readonly chatDetail?: string;
  readonly captionDetail?: string;
  readonly confirm?: MultistreamConfirm;
  readonly editing?: boolean;
  readonly qualified: QualifiedMultistream;
  readonly windowWidth: number;
}): MultistreamView {
  const { layout } = input.qualified;
  const active = new Set(input.qualified.activeSlotIds);
  const paused = new Set(input.qualified.pausedSlotIds);
  const thumbnails = new Set(input.qualified.thumbnailSlotIds);
  const cells: MultistreamCell[] = Array.from(
    { length: MAX_MULTISTREAM_SLOTS },
    (_, index) => {
      const slot = layout.slots[index];
      if (!slot) return { index, kind: "empty" };
      const phase = phaseFor(slot.id, active, paused, thumbnails);
      return {
        audioOwner: layout.audioOwnerId === slot.id,
        focused: layout.focusedSlotId === slot.id,
        index,
        kind: "configured",
        phase,
        sessionId: phase === "active" ? multistreamSessionId(slot.id) : null,
        slot,
      };
    },
  );
  return {
    activeCount: input.qualified.activeSlotIds.length,
    captionDetail: input.captionDetail ?? MULTISTREAM_CAPTION_DETAIL,
    cells,
    chatDetail: input.chatDetail ?? MULTISTREAM_CHAT_DETAIL,
    configuredCount: layout.slots.length,
    confirm: input.confirm ?? { kind: "idle" },
    editing: input.editing === true,
    mode: layout.mode,
    notice: input.qualified.notice,
    title: `Multistream · ${layout.slots.length} configured · ${input.qualified.activeSlotIds.length} active`,
  };
}

export function tabletMultistreamColumns(windowWidth: number): 1 | 2 | 3 {
  if (windowWidth >= 900) return 3;
  if (windowWidth >= 600) return 2;
  return 1;
}

function phaseFor(
  slotId: string,
  active: ReadonlySet<string>,
  paused: ReadonlySet<string>,
  thumbnails: ReadonlySet<string>,
): MultistreamSlotPhase {
  if (active.has(slotId)) return "active";
  if (thumbnails.has(slotId)) return "thumbnail";
  if (paused.has(slotId)) return "paused";
  return "retained";
}
