import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DialogTrigger } from "@/components/ui/dialog";
import {
  renderWithProviders,
  routerMock,
  screen,
  userEvent,
} from "../../../../../../../tests/test-utils";

const mockCheckNow = vi.hoisted(() => vi.fn(async () => true));
const mockNetworkStatus = vi.hoisted(() => vi.fn());
const layoutState = vi.hoisted(() => ({
  pathname: "/",
  currentStream: null as null | { platform: "kick"; channelName: string },
  isTheaterModeActive: false,
  sidebarCollapsed: false,
}));
const setSidebarCollapsed = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  ...routerMock(),
  useLocation: () => ({ pathname: layoutState.pathname }),
}));

vi.mock("@/features/auth/components/hooks/useAuth", () => ({ useAuthInitialize: () => true }));

vi.mock("@/features/settings/components/hooks/useNetworkStatus", () => ({
  useNetworkStatus: mockNetworkStatus,
}));

vi.mock("@/features/shell/components/state/app-store", () => ({
  useAppStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      sidebarCollapsed: layoutState.sidebarCollapsed,
      setSidebarCollapsed,
      isTheaterModeActive: layoutState.isTheaterModeActive,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/features/shell/components/TopNavBar", () => ({
  TopNavBar: ({
    showPlatformHealth,
    mobileMenu,
  }: {
    showPlatformHealth?: boolean;
    mobileMenu?: boolean;
  }) => (
    <div data-testid="top-nav" data-show-platform-health={showPlatformHealth}>
      {mobileMenu && (
        <DialogTrigger asChild>
          <button type="button">Open navigation</button>
        </DialogTrigger>
      )}
      topnav
    </div>
  ),
}));

vi.mock("@/features/shell/components/layout/SidebarFollows", () => ({
  SidebarFollows: () => (
    <div data-testid="sidebar-follows">
      <a href="/stream/kick/creator" onClick={(event) => event.preventDefault()}>
        Followed channel
      </a>
    </div>
  ),
}));

vi.mock("@/features/settings/components/hooks/useElectron", () => ({
  useWindowControls: () => ({
    isMaximized: false,
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock("@/features/playback/components/player/mini-player", () => ({
  MiniPlayer: () => <div data-testid="persistent-live-player" />,
}));

vi.mock("@/features/playback/components/state/pip-store", () => ({
  usePipStore: (selector: (state: typeof layoutState) => unknown) => selector(layoutState),
}));

import { AppLayout } from "@/features/shell/components/layout/AppLayout";

// Guards: the browser keeps application navigation and content without inert native window controls, while Electron retains them.
describe("AppLayout", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "__STREAMFUSION_BROWSER_DEV_CLIENT__");
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
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
    layoutState.sidebarCollapsed = false;
    setSidebarCollapsed.mockClear();
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__STREAMFUSION_BROWSER_DEV_CLIENT__");
    vi.restoreAllMocks();
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

  it.each(["electron", "browser"] as const)(
    "keeps application chrome appropriate to %s",
    (host) => {
      if (host === "browser") window.__STREAMFUSION_BROWSER_DEV_CLIENT__ = true;
      renderWithProviders(
        <AppLayout>
          <div>page-content</div>
        </AppLayout>
      );
      for (const name of ["Minimize", "Maximize", "Close"]) {
        const control = screen.queryByRole("button", { name });
        if (host === "electron") expect(control).toBeInTheDocument();
        else expect(control).not.toBeInTheDocument();
      }
      expect(screen.getByTestId("top-nav")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
      expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
      expect(screen.getByTestId("sidebar-follows")).toBeInTheDocument();
      expect(screen.getByText("page-content")).toBeInTheDocument();
    }
  );

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

  it("opens a focused mobile drawer, closes on Escape, and restores the menu focus", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page-content</AppLayout>);

    expect(screen.queryByTestId("sidebar-follows")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Open navigation" });
    await user.click(trigger);

    const drawer = screen.getByRole("dialog", { name: "StreamFusion" });
    expect(drawer).toContainElement(screen.getByTestId("sidebar-follows"));
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(screen.getAllByTestId("sidebar-follows")).toHaveLength(1);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(drawer).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByTestId("mobile-navigation-backdrop"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "StreamFusion" })).not.toBeInTheDocument()
    );
    expect(trigger).toHaveFocus();
  });

  it("closes mobile navigation after choosing a destination without changing desktop collapse", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    layoutState.sidebarCollapsed = true;
    const user = userEvent.setup();
    renderWithProviders(<AppLayout>page-content</AppLayout>);

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(screen.queryByRole("dialog", { name: "StreamFusion" })).not.toBeInTheDocument();
    expect(setSidebarCollapsed).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(screen.getByRole("link", { name: "Followed channel" }));
    expect(screen.queryByRole("dialog", { name: "StreamFusion" })).not.toBeInTheDocument();

    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("link", { name: "Settings" }).closest("aside")).toHaveClass("w-16");
    expect(screen.getAllByTestId("sidebar-follows")).toHaveLength(1);
  });

  it("preloads sidebar destinations from navigation intent", () => {
    renderWithProviders(
      <AppLayout>
        <div>x</div>
      </AppLayout>
    );

    for (const name of [
      "Home",
      "Following",
      "Categories",
      "MultiView",
      "History",
      "Downloads",
      "Settings",
    ]) {
      expect(screen.getByRole("link", { name })).toHaveAttribute("preload", "intent");
    }
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
