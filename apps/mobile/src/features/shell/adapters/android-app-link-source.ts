import { Linking } from "react-native";

export interface AndroidAppLinkBridge {
  initialUrl(): Promise<string | null>;
  subscribe(listener: (url: string) => void): () => void;
}

export function createAndroidAppLinkBridge(): AndroidAppLinkBridge {
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
