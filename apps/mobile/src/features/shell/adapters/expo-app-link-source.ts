import * as Linking from "expo-linking";

export interface ExpoAppLinkBridge {
  initialUrl(): Promise<string | null>;
  subscribe(listener: (url: string) => void): () => void;
}

export function createExpoAppLinkBridge(): ExpoAppLinkBridge {
  return {
    initialUrl: () => Linking.getInitialURL(),
    subscribe(listener) {
      const subscription = Linking.addEventListener("url", ({ url }) =>
        listener(url),
      );
      return () => subscription.remove();
    },
  };
}
