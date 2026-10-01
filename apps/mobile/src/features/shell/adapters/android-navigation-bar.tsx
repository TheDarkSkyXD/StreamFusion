import { requireOptionalNativeModule } from "expo-modules-core";
import { useEffect } from "react";
import { Platform } from "react-native";

type NativeNavigationBar = {
  readonly setHidden?: (hidden: boolean) => Promise<void> | void;
  readonly setVisibilityAsync?: (
    visibility: "hidden" | "visible",
  ) => Promise<void> | void;
};

function setHidden(module: NativeNavigationBar, hidden: boolean): void {
  const result = module.setHidden
    ? module.setHidden(hidden)
    : module.setVisibilityAsync?.(hidden ? "hidden" : "visible");
  if (result) void Promise.resolve(result).catch(() => undefined);
}

export function AndroidNavigationBar({ hidden }: { readonly hidden: boolean }) {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const module =
      requireOptionalNativeModule<NativeNavigationBar>("ExpoNavigationBar");
    if (!module) return;
    setHidden(module, hidden);
    return () => setHidden(module, false);
  }, [hidden]);
  return null;
}
