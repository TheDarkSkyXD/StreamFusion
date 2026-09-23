import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Linking: { openSettings: vi.fn(async () => undefined) },
  Platform: { Version: 34 },
}));

const getPermissionsAsync = vi.fn();
const requestPermissionsAsync = vi.fn();

vi.mock("../../notifications/adapters/expo-local-notifications-module", () => ({
  loadExpoLocalNotifications: vi.fn(async () => ({
    getPermissionsAsync,
    requestPermissionsAsync,
  })),
}));

describe("android notification permission port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPermissionsAsync.mockResolvedValue({ status: "undetermined" });
    requestPermissionsAsync.mockResolvedValue({ status: "granted" });
  });

  it("maps undetermined to not-requested without requesting", async () => {
    const { createAndroidNotificationPermissionPort, permissionFromStatus } =
      await import("../adapters/android-notification-permission");
    expect(permissionFromStatus("undetermined")).toBe("not-requested");
    expect(permissionFromStatus("granted")).toBe("granted");
    expect(permissionFromStatus("denied")).toBe("denied");

    const snapshot = await createAndroidNotificationPermissionPort().read();
    expect(snapshot).toEqual({ apiLevel: 34, permission: "not-requested" });
    expect(getPermissionsAsync).toHaveBeenCalledOnce();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("requests permission through the local loader for Expo Go-safe prompts", async () => {
    const { createAndroidNotificationPermissionPort } = await import(
      "../adapters/android-notification-permission"
    );
    const snapshot = await createAndroidNotificationPermissionPort().request();
    expect(snapshot).toEqual({ apiLevel: 34, permission: "granted" });
    expect(requestPermissionsAsync).toHaveBeenCalledOnce();
  });
});
