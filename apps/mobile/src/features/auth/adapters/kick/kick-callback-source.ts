import * as Linking from "expo-linking";

import type { KickCallbackSource } from "@mobile/features/auth/capabilities/kick-session";

import { parseKickCallbackUrl } from "./kick-callback-parser";

export type { KickCallbackSource };

export function createKickLinkingCallbackSource(options?: {
  readonly now?: () => number;
}): KickCallbackSource {
  const now = options?.now ?? Date.now;
  return {
    subscribe(listener) {
      const deliver = (url: string | null) => {
        if (!url) return;
        const input = parseKickCallbackUrl(url, now());
        if (input) listener(input);
      };
      const subscription = Linking.addEventListener("url", (event) =>
        deliver(event.url),
      );
      void Linking.getInitialURL().then(deliver);
      return () => subscription.remove();
    },
  };
}
