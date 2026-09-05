import type { AppLinkSource } from "@mobile/capabilities/app-links";
import {
  createExpoAppLinkBridge,
  type ExpoAppLinkBridge,
} from "@mobile/native/expo-app-link-source";
import { parseAppLink } from "@mobile/transport/app-link-parser";

export function createExpoAppLinkSource(
  bridge: ExpoAppLinkBridge = createExpoAppLinkBridge(),
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
