import type { LocalCaptionController } from "../capabilities/local-caption-controller";
import { getDesktopLocalCaptionController } from "../adapters/electron/local-caption-controller";

export const getLocalCaptionController: () => LocalCaptionController = getDesktopLocalCaptionController;
