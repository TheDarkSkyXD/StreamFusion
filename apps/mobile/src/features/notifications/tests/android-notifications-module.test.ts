import { describe, expect, it, vi } from "vitest";

const { native } = vi.hoisted(() => ({
  native: {
    getPermissionStatus: vi.fn(async () => "granted"),
    requestPermission: vi.fn(),
    ensureChannels: vi.fn(),
    present: vi.fn(),
    getInitialResponse: vi.fn(),
    getDevicePushToken: vi.fn(),
    addListener: vi.fn(),
    removeListeners: vi.fn(),
  },
}));

vi.mock("react-native", () => ({ NativeModules: { StreamFusionNotifications: native } }));

import { getNativeNotifications } from "../adapters/android-notifications-module";

describe("native notifications bridge", () => {
  it("reads the registered module", async () => {
    expect(await getNativeNotifications().getPermissionStatus()).toBe("granted");
  });
});
