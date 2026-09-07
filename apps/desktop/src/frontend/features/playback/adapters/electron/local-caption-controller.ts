import type { LocalCaptionController } from "../../capabilities/local-caption-controller";

export function getDesktopLocalCaptionController(): LocalCaptionController {
 return window.electronAPI;
}
