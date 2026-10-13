import { NativeEventEmitter, NativeModules } from "react-native";

export interface NativeNotificationsModule {
  getPermissionStatus(): Promise<"granted" | "denied" | "not-requested" | "unavailable">;
  requestPermission(): Promise<"granted" | "denied" | "not-requested" | "unavailable">;
  ensureChannels(): Promise<void>;
  configureLiveAlerts(enabled: boolean, sound: boolean): Promise<void>;
  present(title: string, body: string, payloadJson: string, channel: string, silent: boolean): Promise<void>;
  getInitialResponse(): Promise<string | null>;
  configureBackgroundChecks(snapshotJson: string): Promise<string>;
  getBackgroundCheckStatus(): Promise<string>;
  readBackgroundEvents(): Promise<string>;
  acknowledgeBackgroundEvents(eventIdsJson: string): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export function getNativeNotifications(): NativeNotificationsModule {
  const module: unknown = NativeModules.StreamFusionNotifications;
  const methods = [
    "getPermissionStatus", "requestPermission", "ensureChannels", "present",
    "getInitialResponse", "configureLiveAlerts", "addListener", "removeListeners",
    "configureBackgroundChecks", "getBackgroundCheckStatus", "readBackgroundEvents", "acknowledgeBackgroundEvents",
  ] as const;
  if (!module || typeof module !== "object" ||
    methods.some((method) => !hasFunction(module, method))) {
    throw new Error("StreamFusion notifications are unavailable.");
  }
  return module as NativeNotificationsModule;
}

function hasFunction(module: object, name: string): boolean {
  const value: unknown = Reflect.get(module, name);
  return typeof value === "function";
}

export function createNotificationEvents() {
  return new NativeEventEmitter(getNativeNotifications());
}
