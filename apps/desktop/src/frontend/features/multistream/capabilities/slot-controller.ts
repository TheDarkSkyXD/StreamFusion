import type { Platform } from "@streamfusion/core/platform";
import type { SlotQualityMode } from "@shared/slot-types";

export interface SlotController {
  requestFocus(slotId: string): Promise<void>;
  setPlaybackBudget(budget: number): Promise<void>;
  setBackgroundQuality(mode: SlotQualityMode): Promise<void>;
  rebindExistingSlots(): Promise<void>;
  createSlot(slotId: string): Promise<void>;
  destroySlot(slotId: string): Promise<void>;
  loadStream(
    slotId: string,
    payload: { platform: Platform; channelName: string; playbackUrl: string }
  ): Promise<void>;
  setBounds(
    slotId: string,
    rect: { x: number; y: number; width: number; height: number }
  ): Promise<void>;
  requestRetry(slotId: string): Promise<void>;
  isWcvEnabled(): Promise<boolean>;
  onRetryAffordance(callback: (event: { slotId: string }) => void): () => void;
}
