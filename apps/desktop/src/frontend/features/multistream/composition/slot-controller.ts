import type { SlotController } from "../capabilities/slot-controller";
import { getDesktopSlotController } from "../adapters/desktop-slot-controller";

export const getSlotController: () => SlotController | undefined = getDesktopSlotController;
