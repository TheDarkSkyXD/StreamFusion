import type { AppLinkSource } from "@mobile/features/shell/capabilities/app-links";
import {
  createAndroidAppLinkBridge,
  type AndroidAppLinkBridge,
} from "@mobile/features/shell/adapters/android-app-link-source";
import { parseAppLink } from "@mobile/features/shell/domain/app-link-parser";

export function createAndroidAppLinkSource(
  bridge: AndroidAppLinkBridge = createAndroidAppLinkBridge(),
): AppLinkSource {
  return {
    async initialIntent() {
      const url = await bridge.initialUrl();
      return url ? parseAppLink(url) : null;
    },
    subscribe(listener) {
      return bridge.subscribe((url) => {
        const intent = parseAppLink(url);
        if (intent) listener(intent);
      });
    },
  };
}
