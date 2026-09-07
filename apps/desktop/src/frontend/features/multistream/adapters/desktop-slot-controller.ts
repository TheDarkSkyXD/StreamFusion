import type { SlotController } from "../capabilities/slot-controller";

export function getDesktopSlotController(): SlotController | undefined {
  return window.electronAPI?.slot;
}
