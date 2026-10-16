import type { ProtectedPlaybackController } from "../capabilities/protected-playback-controller";
import { desktopProtectedPlaybackController } from "../adapters/electron/protected-playback-controller";

export const protectedPlaybackController: ProtectedPlaybackController =
  desktopProtectedPlaybackController;
