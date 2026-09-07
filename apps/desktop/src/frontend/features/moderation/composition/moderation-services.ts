import type { ModerationServices } from "../capabilities/moderation-services";
import { getDesktopModerationServices } from "../adapters/electron/moderation-services";

export const getModerationServices: () => ModerationServices = getDesktopModerationServices;
