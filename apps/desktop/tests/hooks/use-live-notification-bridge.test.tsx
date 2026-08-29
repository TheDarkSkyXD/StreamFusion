import { render, renderHook, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/routes/router", () => ({
  router: { navigate: mockNavigate },
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

import { useLiveNotificationBridge } from "@/features/auth/data/use-live-notification-bridge";
import { resolveProxiedImageSrc } from "@/lib/proxied-image-url";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  type LiveNotificationCoverageStatus,
  type LiveNotificationPayload,
} from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useNotificationStore } from "@/store/notification-store";
import { installElectronAPIMock } from "../test-utils";

let liveCallback: ((notification: LiveNotificationPayload) => void) | null = null;
let openCallback: ((notification: LiveNotificationPayload) => void) | null = null;

const liveNotification: LiveNotificationPayload = {
  id: "twitch:123:1000",
  platform: "twitch",
  channelId: "123",
  channelName: "alpha",
  channelDisplayName: "Alpha",
  title: "Live now",
  createdAt: 1_000,
  channelAvatar: "https://example.com/alpha.png",
};

beforeEach(() => {
  liveCallback = null;
  openCallback = null;
  mockNavigate.mockClear();
  toastMock.mockClear();
  useNotificationStore.setState({ notifications: [] });
  useAuthStore.setState({
    preferences: {
      ...DEFAULT_USER_PREFERENCES,
      notifications: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        toastAlerts: true,
      },
    },
  });
  const api = installElectronAPIMock();
  api.notifications = {
      getCoverageStatus: vi.fn(async (): Promise<LiveNotificationCoverageStatus> => ({
        desktop: { supported: true, permission: "unknown" },
        platforms: {
          twitch: { status: "normal", issues: [] },
          kick: { status: "normal", issues: [] },
        },
      })),
      onLiveNotification: vi.fn((callback: (notification: LiveNotificationPayload) => void) => {
        liveCallback = callback;
        return vi.fn();
      }),
      onOpenLiveNotification: vi.fn((callback: (notification: LiveNotificationPayload) => void) => {
        openCallback = callback;
        return vi.fn();
      }),
  };
});

afterEach(() => {
  useNotificationStore.setState({ notifications: [] });
  useAuthStore.setState({ preferences: null });
  Reflect.deleteProperty(window, "electronAPI");
});

// Guards: renderer must persist live-notification pushes from main so the bell history works for desktop, toast, and guest follows.
// Guards: live toasts must render the supplied Twitch and Kick channel avatars through the platform image proxy.
// Guards: desktop notification clicks navigate through the app router without requiring hook context above RouterProvider.
describe("useLiveNotificationBridge", () => {
  it("adds incoming live notifications to the notification store", () => {
    renderHook(() => useLiveNotificationBridge());

    liveCallback?.(liveNotification);

    expect(useNotificationStore.getState().notifications).toEqual([
      expect.objectContaining({ id: "twitch:123:1000", title: "Live now" }),
    ]);
  });

  it("shows a toast for incoming live notifications when toast alerts are enabled", () => {
    renderHook(() => useLiveNotificationBridge());

    liveCallback?.(liveNotification);

    expect(toastMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: expect.objectContaining({ label: "Watch" }),
      })
    );
  });

  it.each([
    {
      platform: "twitch" as const,
      channelAvatar: "https://static-cdn.jtvnw.net/jtv_user_pictures/alpha-profile_image-70x70.png",
    },
    {
      platform: "kick" as const,
      channelAvatar: "https://files.kick.com/images/user/101/profile_image/fullsize.webp",
    },
  ])(
    "renders the supplied $platform channel avatar in the toast",
    ({ platform, channelAvatar }) => {
      renderHook(() => useLiveNotificationBridge());

      liveCallback?.({
        ...liveNotification,
        platform,
        channelAvatar,
      });

      const toastContent = toastMock.mock.lastCall?.[0];
      expect(isValidElement(toastContent)).toBe(true);
      if (!isValidElement(toastContent)) return;

      render(toastContent);

      expect(screen.getByRole("img", { name: "Alpha" })).toHaveAttribute(
        "src",
        resolveProxiedImageSrc(channelAvatar)
      );
    }
  );

  it("keeps bell history but suppresses toast when toast alerts are disabled", () => {
    useAuthStore.setState({
      preferences: {
        ...DEFAULT_USER_PREFERENCES,
        notifications: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          toastAlerts: false,
        },
      },
    });

    renderHook(() => useLiveNotificationBridge());
    liveCallback?.(liveNotification);

    expect(useNotificationStore.getState().notifications).toEqual([
      expect.objectContaining({ id: "twitch:123:1000" }),
    ]);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("unsubscribes from live-notification pushes on unmount", () => {
    const unsubscribe = vi.fn();
    window.electronAPI!.notifications.onLiveNotification = vi.fn(() => unsubscribe);
    window.electronAPI!.notifications.onOpenLiveNotification = vi.fn(() => vi.fn());

    const { unmount } = renderHook(() => useLiveNotificationBridge());
    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("navigates when the main process reports a desktop notification click without clearing history", () => {
    useNotificationStore.getState().addNotification({
      id: "kick:200:1000",
      platform: "kick",
      channelId: "200",
      channelName: "xqc",
      channelDisplayName: "xQc",
      title: "Live now",
      createdAt: 1_000,
    });

    renderHook(() => useLiveNotificationBridge());
    openCallback?.({
      id: "kick:200:1000",
      platform: "kick",
      channelId: "200",
      channelName: "xqc",
      channelDisplayName: "xQc",
      title: "Live now",
      createdAt: 1_000,
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "kick", channel: "xqc" },
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
  });
});
