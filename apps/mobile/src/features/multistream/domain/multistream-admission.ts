import type { AndroidResourceSnapshot } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
import {
  measureActiveVideoLimit as measureFromProfile,
  type RuntimeDegradationStage,
} from "@mobile/features/capability-profile/domain/capability-profile";
import type {
  ActiveVideoAdmission,
  MultistreamLayout,
  QualifiedMultistream,
} from "../capabilities/multistream";

export function measureActiveVideoLimit(
  observation: AndroidResourceSnapshot,
): ActiveVideoAdmission {
  return measureFromProfile(observation);
}

export function activeCapacityForStage(
  limit: number,
  stage: RuntimeDegradationStage,
): number {
  if (stage >= 3) return 1;
  if (stage >= 2) return Math.min(limit, Math.max(1, Math.ceil(limit / 2)));
  return Math.max(1, limit);
}

export function qualifyMultistream(input: {
  readonly admission: ActiveVideoAdmission;
  readonly layout: MultistreamLayout;
  readonly stage: RuntimeDegradationStage;
}): QualifiedMultistream {
  const capacity = activeCapacityForStage(input.admission.limit, input.stage);
  const ordered = orderedForActivation(input.layout);
  const activeSlotIds = ordered.slice(0, capacity).map((slot) => slot.id);
  const active = new Set(activeSlotIds);
  const inactive = inactiveSlotIds(input.layout, active);
  const thumbnailSlotIds = input.stage >= 3 ? inactive : [];
  const pausedSlotIds =
    input.stage >= 4
      ? inactive.filter((id) => !thumbnailSlotIds.includes(id))
      : [];
  const fallbackOwner = activeSlotIds[0] ?? null;
  const audioOwnerId =
    input.layout.audioOwnerId && active.has(input.layout.audioOwnerId)
      ? input.layout.audioOwnerId
      : fallbackOwner;
  const focusedSlotId =
    input.layout.focusedSlotId && active.has(input.layout.focusedSlotId)
      ? input.layout.focusedSlotId
      : fallbackOwner;
  return {
    activeSlotIds,
    admission: input.admission,
    layout: {
      ...input.layout,
      audioOwnerId,
      focusedSlotId,
    },
    notice: admissionNotice(input, activeSlotIds.length),
    pausedSlotIds,
    thumbnailSlotIds,
  };
}

function inactiveSlotIds(
  layout: MultistreamLayout,
  active: ReadonlySet<string>,
): readonly string[] {
  return layout.slots.map((slot) => slot.id).filter((id) => !active.has(id));
}

function admissionNotice(
  input: {
    readonly admission: ActiveVideoAdmission;
    readonly layout: MultistreamLayout;
    readonly stage: RuntimeDegradationStage;
  },
  activeCount: number,
): string | null {
  if (input.layout.slots.length === 0) return null;
  const retained = input.layout.slots.length - activeCount;
  if (input.stage > 0) {
    return `${input.admission.reason} Stage ${input.stage} keeps ${activeCount} active and ${retained} retained.`;
  }
  if (retained > 0) {
    return `${input.admission.reason} ${retained} configured slot${retained === 1 ? "" : "s"} stay retained.`;
  }
  return input.admission.reason;
}

function orderedForActivation(layout: MultistreamLayout): MultistreamLayout["slots"] {
  if (!layout.focusedSlotId) return layout.slots;
  const focused = layout.slots.filter((slot) => slot.id === layout.focusedSlotId);
  const rest = layout.slots.filter((slot) => slot.id !== layout.focusedSlotId);
  return [...focused, ...rest];
}
