// Guards: direct links to both developer-only settings resolve in development
// and fall back to Playback in production after leaving the sidebar navigation.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PROXY_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
} from "@shared/auth-types";

import {
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from "../test-utils";

const routerState = vi.hoisted(() => ({
  search: { tab: "playback" },
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  ...routerMock({ search: routerState.search }),
  useNavigate: () => routerState.navigate,
}));

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

vi.mock("@/features/auth/data/useAuth", () => ({
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
        ...DEFAULT_USER_PREFERENCES,
        playback: { ...DEFAULT_USER_PREFERENCES.playback, defaultQuality: "auto", autoplay: true },
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

vi.mock("@/features/auth/components/auth/AccountConnect", () => ({
  AccountConnect: () => <div data-testid="account-connect">accounts</div>,
}));

vi.mock("@/features/settings/components/settings/LogsSection", () => ({
  LogsSection: () => <div data-testid="logs-section">logs-section</div>,
}));

vi.mock("@/features/settings/components/settings/BugReportSection", () => ({
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
}

import { SettingsPage } from "@/pages/Settings";

const DEVELOPER_ONLY_PANELS = [
  { tab: "logs", testId: "logs-section" },
  { tab: "report-bug", testId: "bug-report-section" },
] as const;

// Guards: Settings mocks include every persisted preference group when the schema grows.
describe("SettingsPage — developer-only deep links", () => {
  beforeEach(() => {
    updatePreferences.mockReset();
    routerState.search.tab = "playback";
    routerState.navigate.mockReset();
  });

  it.each(DEVELOPER_ONLY_PANELS)(
    "mounts the $tab panel for a direct development link",
    async ({ tab, testId }) => {
      routerState.search.tab = tab;
      installEnvMock(true);
      renderWithProviders(<SettingsPage />);
      expect(await screen.findByTestId(testId)).toBeInTheDocument();
      expect(routerState.navigate).not.toHaveBeenCalledWith(
        expect.objectContaining({ search: { tab: "playback" } })
      );
    }
  );

  it.each(DEVELOPER_ONLY_PANELS)(
    "redirects a direct $tab link to Playback in production",
    async ({ tab, testId }) => {
      routerState.search.tab = tab;
      installEnvMock(false);
      renderWithProviders(<SettingsPage />);

      await waitFor(() => {
        expect(routerState.navigate).toHaveBeenCalledWith({
          to: "/settings",
          search: { tab: "playback" },
          replace: true,
        });
      });
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  );
});
