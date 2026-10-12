import { getPlatformModule } from "../../../../modules/streamfusion-native-contracts/src/platform";

import type { WatchOrientationController } from "../domain/watch-fullscreen-orientation";

export function createNativeOrientationController(): WatchOrientationController {
  return { lockAsync: (lock) => getPlatformModule().lockOrientation(lock) };
}
