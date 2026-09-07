import type { ModerationServices } from "../../capabilities/moderation-services";

export function getDesktopModerationServices(): ModerationServices {
 return window.electronAPI;
}
