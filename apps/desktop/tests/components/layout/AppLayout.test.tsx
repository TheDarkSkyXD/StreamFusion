import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders, routerMock, screen } from "../../test-utils";

const mockCheckNow = vi.hoisted(() => vi.fn(async () => true));
const mockNetworkStatus = vi.hoisted(() => vi.fn());
const layoutState = vi.hoisted(() => ({
  pathname: "/",
  currentStream: null as null | { platform: "kick"; channelName: string },
  isTheaterModeActive: false,
}));

vi.mock("@tanstack/react-router", () => ({
  ...routerMock(),
  useLocation: () => ({ pathname: layoutState.pathname }),
}));

vi.mock("@/hooks/useAuth", () => ({ useAuthInitialize: () => true }));

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: mockNetworkStatus,
}));

vi.mock("@/store/app-store", () => ({
  useAppStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      sidebarCollapsed: false,
      setSidebarCollapsed: vi.fn(),
      isTheaterModeActive: layoutState.isTheaterModeActive,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/components/TopNavBar", () => ({
  TopNavBar: ({ showPlatformHealth }: { showPlatformHealth?: boolean }) => (
    <div data-testid="top-nav" data-show-platform-health={showPlatformHealth}>
      topnav
    </div>
  ),
}));

vi.mock("@/components/layout/SidebarFollows", () => ({
  SidebarFollows: () => <div data-testid="sidebar-follows">follows</div>,
}));

vi.mock("@/components/layout/TitleBar", () => ({
  TitleBar: () => <div data-testid="title-bar">title</div>,
}));

vi.mock("@/components/player/mini-player", () => ({
  MiniPlayer: () => <div data-testid="persistent-live-player" />,
}));

vi.mock("@/store/pip-store", () => ({
  usePipStore: (selector: (state: typeof layoutState) => unknown) => selector(layoutState),
}));

import { AppLayout } from "@/components/layout/AppLayout";

describe("AppLayout", () => {
  beforeEach(() => {
    mockNetworkStatus.mockReturnValue({
      isOnline: true,
      isOffline: false,
      isChecking: false,
      status: "online",
      nextRetryAt: null,
      retryInSeconds: null,
      checkNow: mockCheckNow,
    });
    layoutState.pathname = "/";
    layoutState.currentStream = null;
    layoutState.isTheaterModeActive = false;
  });

  // Guards: the app shell owns one live-player tree on stream routes so route-to-mini handoff cannot unmount its video or HLS instance.
  it("keeps the persistent live player mounted in the app shell on its stream route", async () => {
    layoutState.pathname = "/stream/kick/xqc";
    layoutState.currentStream = { platform: "kick", channelName: "xqc" };

    renderWithProviders(
      <AppLayout>
        <div id="persistent-live-player-dock" />
      </AppLayout>
    );

    expect(await screen.findByTestId("persistent-live-player")).toBeInTheDocument();
  });

  it("renders title bar, top nav, and children", () => {
    renderWithProviders(
      <AppLayout>
        <div>page-content</div>
      </AppLayout>
    );
    expect(screen.getByTestId("title-bar")).toBeInTheDocument();
    expect(screen.getByTestId("top-nav")).toBeInTheDocument();
    expect(screen.getByText("page-content")).toBeInTheDocument();
  });

  it("renders nav links for each route", () => {
    renderWithProviders(
      <AppLayout>
        <div>x</div>
      </AppLayout>
    );
    expect(screen.getAllByText(/home/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/following/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/categories/i).length).toBeGreaterThan(0);
  });

  it("shows the offline banner instead of the platform banner while the app is offline", () => {
    mockNetworkStatus.mockReturnValue({
      isOnline: false,
      isOffline: true,
      isChecking: false,
      status: "offline",
      nextRetryAt: Date.now() + 5_000,
      retryInSeconds: 5,
      checkNow: mockCheckNow,
    });

    renderWithProviders(
      <AppLayout>
        <div>page-content</div>
      </AppLayout>
    );

    expect(screen.getByRole("status")).toHaveTextContent("No internet connection");
    expect(screen.getByTestId("top-nav")).toHaveAttribute("data-show-platform-health", "false");
  });

  it("keeps the offline card visible above player controls in theater mode", () => {
    layoutState.isTheaterModeActive = true;
    mockNetworkStatus.mockReturnValue({
      isOnline: false,
      isOffline: true,
      isChecking: false,
      status: "offline",
      nextRetryAt: Date.now() + 5_000,
      retryInSeconds: 5,
      checkNow: mockCheckNow,
    });

    renderWithProviders(
      <AppLayout>
        <div>page-content</div>
      </AppLayout>
    );

    expect(screen.getByTestId("network-status-card")).toHaveClass("bottom-16");
    expect(screen.queryByTestId("top-nav")).toBeNull();
  });

  it("keeps confirmed-offline retry probes visible as checking", () => {
    mockNetworkStatus.mockReturnValue({
      isOnline: false,
      isOffline: true,
      isChecking: true,
      status: "offline",
      nextRetryAt: null,
      retryInSeconds: null,
      checkNow: mockCheckNow,
    });

    renderWithProviders(
      <AppLayout>
        <div>page-content</div>
      </AppLayout>
    );

    expect(screen.getByTestId("network-status-card")).toHaveTextContent("Checking connection…");
  });
});
