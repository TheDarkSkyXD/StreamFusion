/**
 * SlotHost — main-process wrapper around a single StreamSlot. Slice 04 of the
 * renderer-OOM PRD (#51). No WebContentsView yet: dispatch calls route through
 * the slot-controller emitter, which the host renderer subscribes to over IPC.
 *
 * Slice 05 will swap the dispatch impl to drive a WCV directly. Call sites
 * never change.
 */

import {
  createSlot,
  destroySlot,
  dispatchLoadStream,
  dispatchSetBufferConfig,
  dispatchSetMute,
  dispatchSetQuality,
  dispatchUnload,
} from "./slot-controller";
import type {
  LoadStreamPayload,
  SlotBufferConfig,
  SlotQualityConfig,
} from "../../../shared/slot-types";

export interface SlotHost {
  readonly id: string;
  create(): void;
  destroy(): void;
  dispatch: {
    loadStream(payload: LoadStreamPayload): void;
    setMute(muted: boolean): void;
    setQuality(config: SlotQualityConfig): void;
    setBufferConfig(config: SlotBufferConfig): void;
    unload(): void;
  };
}

export function createSlotHost(id: string): SlotHost {
  return {
    id,
    create: () => createSlot(id),
    destroy: () => destroySlot(id),
    dispatch: {
      loadStream: (payload) => dispatchLoadStream(id, payload),
      setMute: (muted) => dispatchSetMute(id, muted),
      setQuality: (config) => dispatchSetQuality(id, config),
      setBufferConfig: (config) => dispatchSetBufferConfig(id, config),
      unload: () => dispatchUnload(id),
    },
  };
}
