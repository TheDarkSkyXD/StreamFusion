import { beforeEach, describe, expect, it, vi } from "vitest";

const { read, request } = vi.hoisted(() => ({
  read: vi.fn(async () => "not-requested"),
  request: vi.fn(async () => "granted"),
}));

vi.mock("react-native", () => ({
  Linking: { openSettings: vi.fn(async () => undefined) },
  Platform: { Version: 34 },
}));
vi.mock("../../notifications/adapters/android-notifications-module", () => ({
  getNativeNotifications: () => ({ getPermissionStatus: read, requestPermission: request }),
}));

import {
  createAndroidNotificationPermissionPort,
  permissionFromStatus,
} from "../adapters/android-notification-permission";

describe("android notification permission port", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    read.mockResolvedValue("not-requested");
    request.mockResolvedValue("granted");
  });

  it("reads an unrequested permission without prompting", async () => {
    expect(permissionFromStatus("not-requested")).toBe("not-requested");
    expect(await createAndroidNotificationPermissionPort().read()).toEqual({
      apiLevel: 34, permission: "not-requested",
    });
    expect(read).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it("requests Android notification permission", async () => {
    expect(await createAndroidNotificationPermissionPort().request()).toEqual({
      apiLevel: 34, permission: "granted",
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
