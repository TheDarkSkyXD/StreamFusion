import { useEffect } from "react";
import { Platform } from "react-native";

import { getPlatformModule } from "../../../../modules/streamfusion-native-contracts/src/platform";

export function AndroidNavigationBar({ hidden }: { readonly hidden: boolean }) {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void getPlatformModule().setNavigationBarHidden(hidden).catch(() => undefined);
    return () => {
      void getPlatformModule().setNavigationBarHidden(false).catch(() => undefined);
    };
  }, [hidden]);
  return null;
}
