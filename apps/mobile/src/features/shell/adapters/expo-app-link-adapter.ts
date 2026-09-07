import type { AppLinkSource } from "@mobile/features/shell/capabilities/app-links";
import {
  createExpoAppLinkBridge,
  type ExpoAppLinkBridge,
} from "@mobile/features/shell/adapters/expo-app-link-source";
import { parseAppLink } from "@mobile/features/shell/domain/app-link-parser";

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
