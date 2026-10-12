import { NativeEventEmitter, NativeModules } from "react-native";

export interface StreamFusionPlatformModule {
  readonly appName: string;
  readonly appVersion: string;
  readonly appScheme: string;
  readonly runtimeHost: "bare";
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  sha256(value: string): Promise<string>;
  setClipboardText(value: string): Promise<void>;
  getNetworkConnected(): Promise<boolean>;
  openAuthorizationTab(url: string): Promise<void>;
  performHaptic(kind: "selection" | "light" | "medium" | "warning"): Promise<void>;
  lockOrientation(lock: "landscape" | "portrait-up"): Promise<void>;
  setNavigationBarHidden(hidden: boolean): Promise<void>;
  setSystemChromeColor(color: string): Promise<void>;
}

export function getPlatformModule(): StreamFusionPlatformModule {
  const module: unknown = NativeModules.StreamFusionPlatform;
  if (!module || typeof module !== "object") {
    throw new Error("StreamFusion platform services are unavailable.");
  }
  const methods = [
    "sha256", "setClipboardText", "getNetworkConnected", "openAuthorizationTab",
    "performHaptic", "lockOrientation", "setNavigationBarHidden",
    "setSystemChromeColor", "addListener", "removeListeners",
  ] as const;
  if (
    !("appName" in module) || typeof module.appName !== "string" ||
    !("appVersion" in module) || typeof module.appVersion !== "string" ||
    !("appScheme" in module) ||
    (module.appScheme !== "streamfusion" && module.appScheme !== "streamfusion-development") ||
    !("runtimeHost" in module) || module.runtimeHost !== "bare" ||
    methods.some((method) => !hasFunction(module, method))
  ) {
    throw new Error("StreamFusion platform services are unavailable.");
  }
  return module as StreamFusionPlatformModule;
}

function hasFunction(module: object, name: string): boolean {
  const value: unknown = Reflect.get(module, name);
  return typeof value === "function";
}

export function subscribeNetworkChange(listener: () => void): () => void {
  const module = getPlatformModule();
  const events = new NativeEventEmitter(module);
  const subscription = events.addListener("networkChanged", listener);
  return () => subscription.remove();
}
