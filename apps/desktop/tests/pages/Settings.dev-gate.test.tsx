// Guards: the Settings sidebar must dev-gate the Logs tab — visible only
// when `env.get()` reports isDev === true. In prod (isDev:false) the Logs
// sidebar item is hidden AND a deep-link `?tab=logs` falls back to the
// default tab. The Report Bug section is also dev-only (same gate as Logs).
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PROXY_PREFERENCES,
} from "@/shared/auth-types";

import {
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  userEvent,
  waitFor,
} from "../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

vi.mock("@/hooks", () => ({
  useAppVersion: () => "1.0.0-test",
  useAppVersionInfo: () => ({ name: "StreamFusion", version: "1.0.0-test" }),
  useUpdater: () => ({
    status: "idle",
    updateInfo: null,
    progress: null,
    error: null,
    allowPrerelease: false,
    autoCheckEnabled: false,
    checkFrequency: "daily",
    isChecking: false,
    isDownloading: false,
    isUpdateAvailable: false,
    isUpdateDownloaded: false,
    hasError: false,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    setAllowPrerelease: vi.fn(),
    setAutoCheckEnabled: vi.fn(),
    setCheckFrequency: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuthError: () => ({ error: null, clearError: vi.fn() }),
}));

const updatePreferences = vi.fn();
const playerControls = { ...DEFAULT_PLAYER_CONTROLS_PREFERENCES };
const buffer = { ...DEFAULT_BUFFER_PREFERENCES };
const proxy = { ...DEFAULT_PROXY_PREFERENCES };
const playbackAdvanced = { ...DEFAULT_PLAYBACK_ADVANCED_PREFERENCES };
vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      preferences: {
        playback: { defaultQuality: "auto", autoplay: true },
        playerControls,
        buffer,
        proxy,
        playbackAdvanced,
      },
      updatePreferences,
      loginTwitch: vi.fn(),
      loginKick: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/store/adblock-store", () => ({
  useAdBlockStore: (selector?: (s: unknown) => unknown) => {
    const state = { enableAdBlock: true, setEnableAdBlock: vi.fn() };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/components/auth", () => ({
  AccountConnect: () => <div data-testid="account-connect">accounts</div>,
}));

vi.mock("@/components/settings/LogsSection", () => ({
  LogsSection: () => <div data-testid="logs-section">logs-section</div>,
}));

vi.mock("@/components/settings/BugReportSection", () => ({
  BugReportSection: () => <div data-testid="bug-report-section">bug-report</div>,
}));

function installEnvMock(isDev: boolean) {
  const api = installElectronAPIMock();
  const get = vi.fn(async () => ({
    isDev,
    platform: "win32" as NodeJS.Platform,
    appVersion: "1.0.0-test",
    electronVersion: "35.0.0",
    nodeVersion: "20.0.0",
  }));
  api.env = { get };
  // Logs section's mount probes — provide quiet stubs so optional chaining is
  // happy (the section is mocked out anyway, but the gating effect runs).
  api.logs = {
    getCurrentPath: vi.fn(async () => "/tmp/streamfusion.log"),
    getNoisePath: vi.fn(async () => "/tmp/streamfusion-noise.log"),
    getNetworkPath: vi.fn(async () => "/tmp/streamfusion-network.log"),
    tail: vi.fn(async () => []),
    openFolder: vi.fn(async () => ({ ok: true })),
  };
  api.bugReports = {
    write: vi.fn(),
    openFolder: vi.fn(),
    list: vi.fn(async () => []),
    getDir: vi.fn(async () => "/tmp/bug-reports"),
  };
  return { api, get };
}

import { SettingsPage } from "@/pages/Settings";

describe("SettingsPage — dev gate for LogsSection", () => {
  beforeEach(() => {
    updatePreferences.mockReset();
  });

  it("hides the Logs sidebar item in prod (isDev:false)", async () => {
    const { get } = installEnvMock(false);
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    expect(screen.queryByText(/in-app log viewer & diagnostics/i)).toBeNull();
  });

  it("shows the Logs sidebar item in dev (isDev:true)", async () => {
    const { get } = installEnvMock(true);
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    expect(screen.getByText(/in-app log viewer & diagnostics/i)).toBeInTheDocument();
  });

  it("mounts LogsSection when the Logs tab is active in dev", async () => {
    const { get } = installEnvMock(true);
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    await user.click(screen.getByText("Logs"));
    expect(screen.getByTestId("logs-section")).toBeInTheDocument();
  });

  it("does not mount LogsSection in prod even if the active tab would be 'logs'", async () => {
    const { get } = installEnvMock(false);
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    expect(screen.queryByTestId("logs-section")).toBeNull();
  });

  it("shows the Report Bug sidebar item + mounts BugReportSection in dev", async () => {
    const devCase = installEnvMock(true);
    const devUser = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(devCase.get).toHaveBeenCalled());
    expect(screen.getByText("Report Bug")).toBeInTheDocument();
    await devUser.click(screen.getByText("Report Bug"));
    expect(screen.getByTestId("bug-report-section")).toBeInTheDocument();
  });

  it("hides the Report Bug sidebar item + does not mount BugReportSection in prod", async () => {
    const prodCase = installEnvMock(false);
    renderWithProviders(<SettingsPage />);
    await waitFor(() => expect(prodCase.get).toHaveBeenCalled());
    expect(screen.queryByText("Report Bug")).toBeNull();
    expect(screen.queryByTestId("bug-report-section")).toBeNull();
  });
});

describe("SettingsPage — dev gate, prod deep-link to ?tab=logs", () => {
  beforeEach(() => {
    updatePreferences.mockReset();
    vi.resetModules();
  });

  it("redirects ?tab=logs to the default tab in prod", async () => {
    // Re-mock the router for this file with search:{tab:'logs'} via vi.doMock.
    vi.doMock("@tanstack/react-router", () => routerMock({ search: { tab: "logs" } }));
    const { get } = installEnvMock(false);
    // Re-import the page after re-mocking the router.
    const { SettingsPage: PageWithLogsDeepLink } = await import("@/pages/Settings");
    renderWithProviders(<PageWithLogsDeepLink />);
    await waitFor(() => expect(get).toHaveBeenCalled());

    // The Logs section isn't mounted, and the default-tab content is visible.
    expect(screen.queryByTestId("logs-section")).toBeNull();
    // Playback is the default. Its <h2> heading "Playback" is unique to that tab.
    expect(screen.getByRole("heading", { level: 2, name: /^Playback$/i })).toBeInTheDocument();
    vi.doUnmock("@tanstack/react-router");
  });
});
