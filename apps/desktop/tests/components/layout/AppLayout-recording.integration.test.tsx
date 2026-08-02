import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { StreamRecordingSnapshot } from "@/shared/stream-recording-types";
import { installElectronAPIMock, renderWithProviders, routerMock, screen } from "../../test-utils";

const route = vi.hoisted(() => ({ pathname: "/following" }));

vi.mock("@tanstack/react-router", () => ({
  ...routerMock(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: route.pathname } }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuthInitialize: vi.fn() }));
vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ isOnline: true, isOffline: false }),
}));
vi.mock("@/store/app-store", () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      sidebarCollapsed: false,
      setSidebarCollapsed: vi.fn(),
      isTheaterModeActive: false,
    }),
}));
vi.mock("@/store/pip-store", () => ({
  usePipStore: (selector: (state: unknown) => unknown) =>
    selector({ currentStream: null, isPipActive: false, isOnStreamPage: false }),
}));
vi.mock("@/components/TopNavBar/SearchBar", () => ({ SearchBar: () => null }));
vi.mock("@/components/TopNavBar/NotificationsDropdown", () => ({
  NotificationsDropdown: () => null,
}));
vi.mock("@/components/auth", () => ({ ProfileDropdown: () => null }));
vi.mock("@/components/layout/SidebarFollows", () => ({ SidebarFollows: () => null }));
vi.mock("@/components/layout/TitleBar", () => ({ TitleBar: () => null }));
vi.mock("@/components/layout/PlatformHealthBanner", () => ({
  PlatformHealthBanner: () => null,
}));
vi.mock("@/components/player/mini-player", () => ({ MiniPlayer: () => null }));

import { AppLayout } from "@/components/layout/AppLayout";

// Guards: the real app shell keeps one provider-backed recording pill across route content changes
// Guards: the real TopNav indicator does not add a second bridge hydration or state listener
describe("AppLayout recording integration", () => {
  it("persists the real indicator across routes with exactly one bridge subscription", async () => {
    const api = installElectronAPIMock();
    const snapshot: StreamRecordingSnapshot = {
      active: {
        sessionId: "recording-session-1",
        platform: "kick",
        channelName: "xqc",
        title: "Live now",
        status: "recording",
        qualityLabel: "1080p60",
        capturedDurationSeconds: 62,
      },
      notice: null,
    };
    api.streamRecording.getState = vi.fn(async () => snapshot);
    api.streamRecording.onStateChanged = vi.fn(() => vi.fn());

    const view = renderWithProviders(
      <AppLayout>
        <div>following route</div>
      </AppLayout>
    );
    const accessibleName = /Stream recording.*xqc on Kick.*1:02 captured.*show details/i;
    expect(await screen.findByRole("button", { name: accessibleName })).toBeVisible();
    expect(api.streamRecording.getState).toHaveBeenCalledTimes(1);
    expect(api.streamRecording.onStateChanged).toHaveBeenCalledTimes(1);

    route.pathname = "/settings";
    view.rerender(
      <AppLayout>
        <div>settings route</div>
      </AppLayout>
    );

    expect(screen.getByText("settings route")).toBeVisible();
    expect(screen.getByRole("button", { name: accessibleName })).toBeVisible();
    await waitFor(() => {
      expect(api.streamRecording.getState).toHaveBeenCalledTimes(1);
      expect(api.streamRecording.onStateChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("mounts one accessible terminal outcome bridge outside Downloads", async () => {
    route.pathname = "/following";
    const api = installElectronAPIMock();
    api.streamRecording.getState = vi.fn(async () => ({
      active: null,
      notice: {
        sessionId: "recording-session-failed",
        outcome: "failed" as const,
        platform: "twitch" as const,
        channelName: "ninja",
        title: "Live now",
        error: "No playable recording was saved",
        delivery: "in-app" as const,
      },
    }));
    api.streamRecording.onStateChanged = vi.fn(() => vi.fn());

    renderWithProviders(
      <AppLayout>
        <div>following route</div>
      </AppLayout>
    );

    expect(await screen.findByRole("status")).toHaveTextContent("Recording failed");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Open recording" })).toBeNull();
    expect(api.downloads.getQueue).not.toHaveBeenCalled();
    expect(api.streamRecording.onStateChanged).toHaveBeenCalledTimes(1);
  });
});
