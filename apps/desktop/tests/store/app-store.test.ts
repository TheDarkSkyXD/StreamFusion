import { beforeEach, describe, expect, it } from "vitest";

import {
  HOME_CAROUSEL_INTERVAL_DEFAULT_MS,
  HOME_CAROUSEL_INTERVAL_MAX_MS,
  HOME_CAROUSEL_INTERVAL_MIN_MS,
  useAppStore,
} from "@/store/app-store";

function resetStore() {
  useAppStore.setState({
    sidebarOpen: true,
    sidebarCollapsed: false,
    userPrefersSidebarCollapsed: false,
    isTheaterModeActive: false,
    showDebugOverlay: false,
    homeCarouselIntervalMs: HOME_CAROUSEL_INTERVAL_DEFAULT_MS,
  });
}

beforeEach(() => resetStore());

describe("app-store sidebar", () => {
  it("toggleSidebar flips sidebarOpen", () => {
    expect(useAppStore.getState().sidebarOpen).toBe(true);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(false);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(true);
  });

  it("setSidebarCollapsed sets collapsed state without updating user preference by default", () => {
    useAppStore.getState().setSidebarCollapsed(true);
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    expect(useAppStore.getState().userPrefersSidebarCollapsed).toBe(false);
  });

  it("setSidebarCollapsed with isUserAction=true also updates user preference", () => {
    useAppStore.getState().setSidebarCollapsed(true, true);
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    expect(useAppStore.getState().userPrefersSidebarCollapsed).toBe(true);
  });
});

describe("app-store theater mode", () => {
  it("entering theater mode collapses the sidebar", () => {
    useAppStore.getState().setTheaterModeActive(true);
    expect(useAppStore.getState().isTheaterModeActive).toBe(true);
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
  });

  it("exiting theater mode restores the user's sidebar preference (uncollapsed)", () => {
    useAppStore.getState().setSidebarCollapsed(false, true);
    useAppStore.getState().setTheaterModeActive(true);
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    useAppStore.getState().setTheaterModeActive(false);
    expect(useAppStore.getState().sidebarCollapsed).toBe(false);
  });

  it("exiting theater mode restores user preference (collapsed)", () => {
    useAppStore.getState().setSidebarCollapsed(true, true);
    useAppStore.getState().setTheaterModeActive(true);
    useAppStore.getState().setTheaterModeActive(false);
    expect(useAppStore.getState().sidebarCollapsed).toBe(true);
  });
});

describe("app-store debug overlay", () => {
  it("setShowDebugOverlay changes the flag", () => {
    useAppStore.getState().setShowDebugOverlay(true);
    expect(useAppStore.getState().showDebugOverlay).toBe(true);
    useAppStore.getState().setShowDebugOverlay(false);
    expect(useAppStore.getState().showDebugOverlay).toBe(false);
  });
});

describe("app-store home carousel", () => {
  it("setHomeCarouselIntervalMs clamps to the supported range", () => {
    useAppStore.getState().setHomeCarouselIntervalMs(5_000);
    expect(useAppStore.getState().homeCarouselIntervalMs).toBe(HOME_CAROUSEL_INTERVAL_MIN_MS);

    useAppStore.getState().setHomeCarouselIntervalMs(60_000);
    expect(useAppStore.getState().homeCarouselIntervalMs).toBe(60_000);

    useAppStore.getState().setHomeCarouselIntervalMs(180_000);
    expect(useAppStore.getState().homeCarouselIntervalMs).toBe(HOME_CAROUSEL_INTERVAL_MAX_MS);
  });
});
