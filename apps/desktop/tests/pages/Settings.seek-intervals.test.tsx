import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PROXY_PREFERENCES,
} from "@/shared/auth-types";
import {
  DEFAULT_SEEK_INTERVAL_SECONDS,
  SEEK_INTERVAL_STORAGE_KEY,
  useSeekIntervalStore,
} from "@/store/seek-interval-store";

import { renderWithProviders, routerMock, screen, userEvent } from "../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess },
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

vi.mock("@/hooks/useAuth", () => ({
  useAuthError: () => ({ error: null, clearError: vi.fn() }),
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      preferences: {
        playback: { defaultQuality: "auto", autoplay: true },
        playerControls: DEFAULT_PLAYER_CONTROLS_PREFERENCES,
        buffer: DEFAULT_BUFFER_PREFERENCES,
        proxy: DEFAULT_PROXY_PREFERENCES,
        playbackAdvanced: DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
        notifications: DEFAULT_NOTIFICATION_PREFERENCES,
      },
      updatePreferences: vi.fn(),
      loginTwitch: vi.fn(),
      loginKick: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/store/adblock-store", () => ({
  useAdBlockStore: (selector?: (state: unknown) => unknown) => {
    const state = { enableAdBlock: true, setEnableAdBlock: vi.fn() };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/components/auth", () => ({
  AccountConnect: () => <div data-testid="account-connect">accounts</div>,
}));

import { SettingsPage } from "@/pages/Settings";

beforeEach(() => {
  localStorage.removeItem(SEEK_INTERVAL_STORAGE_KEY);
  useSeekIntervalStore.setState({
    rewindSeconds: DEFAULT_SEEK_INTERVAL_SECONDS,
    forwardSeconds: DEFAULT_SEEK_INTERVAL_SECONDS,
  });
  toastSuccess.mockReset();
});

// Guards: Player controls expose searchable, accessible whole-second seek intervals for VODs and clips only.
// Guards: rewind and fast-forward values persist independently through the real seek interval store.
describe("Settings seek intervals", () => {
  it("exposes both Xtra-style controls and filters them through Settings search", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.type(screen.getByRole("textbox", { name: "Search settings" }), "rewind");

    expect(await screen.findByRole("heading", { name: "Player controls" })).toBeInTheDocument();
    expect(
      screen.getByText("Seek intervals apply to VODs and clips. Live streams are unaffected.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Fast forward" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search" }));

    const controls = [
      {
        input: screen.getByRole("spinbutton", { name: "Rewind" }),
        description: "Seconds skipped backward in VODs and clips.",
      },
      {
        input: screen.getByRole("spinbutton", { name: "Fast forward" }),
        description: "Seconds skipped forward in VODs and clips.",
      },
    ];

    for (const { input, description } of controls) {
      expect(input).toHaveValue(DEFAULT_SEEK_INTERVAL_SECONDS);
      expect(input).toHaveAccessibleDescription(description);
      expect(input).toHaveAttribute("min", "0");
      expect(input).toHaveAttribute("step", "1");
      expect(input).not.toHaveAttribute("max");
      input.focus();
      expect(input).toHaveFocus();
    }
  });

  it("persists rewind and fast forward immediately without coupling their values", async () => {
    useSeekIntervalStore.getState().setForwardSeconds(25);
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await user.click(screen.getByText("Player controls"));

    fireEvent.change(screen.getByRole("spinbutton", { name: "Rewind" }), {
      target: { value: "0" },
    });

    expect(useSeekIntervalStore.getState().rewindSeconds).toBe(0);
    expect(useSeekIntervalStore.getState().forwardSeconds).toBe(25);
    expect(JSON.parse(localStorage.getItem(SEEK_INTERVAL_STORAGE_KEY) ?? "{}").state).toEqual({
      rewindSeconds: 0,
      forwardSeconds: 25,
    });

    fireEvent.change(screen.getByRole("spinbutton", { name: "Fast forward" }), {
      target: { value: "30" },
    });

    expect(useSeekIntervalStore.getState().rewindSeconds).toBe(0);
    expect(useSeekIntervalStore.getState().forwardSeconds).toBe(30);
    expect(JSON.parse(localStorage.getItem(SEEK_INTERVAL_STORAGE_KEY) ?? "{}").state).toEqual({
      rewindSeconds: 0,
      forwardSeconds: 30,
    });
    expect(toastSuccess).toHaveBeenCalledTimes(2);
    expect(toastSuccess).toHaveBeenLastCalledWith("Settings saved", { id: "settings-saved" });
  });
});
