import { act, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";

import { DEFAULT_CHAT_DISPLAY_PREFERENCES, DEFAULT_CHAT_PREFERENCES } from "@/shared/auth-types";

import {
  installElectronAPIMock,
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from "../test-utils";

const routerState = vi.hoisted(() => ({
  search: {} as Record<string, unknown>,
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, search, onClick, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to?: string;
    search?: Record<string, unknown>;
  }) => (
    <a
      href={to}
      data-search={JSON.stringify(search)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        routerState.navigate({ to, search });
      }}
      {...props}
    >
      {children}
    </a>
  ),
  useNavigate: () => routerState.navigate,
  useSearch: () => routerState.search,
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

const updatePreferences = vi.fn(async () => {});
const storeState = {
  preferences: {
    chatDisplay: DEFAULT_CHAT_DISPLAY_PREFERENCES,
    chat: DEFAULT_CHAT_PREFERENCES,
  },
  updatePreferences,
  loginTwitch: vi.fn(),
  loginKick: vi.fn(),
};

vi.mock("@/store/auth-store", () => ({
  useAuthStore: Object.assign(
    (selector?: (state: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState,
    { getState: () => storeState }
  ),
}));

vi.mock("@/store/adblock-store", () => ({
  useAdBlockStore: (
    selector?: (state: {
      enableAdBlock: boolean;
      setEnableAdBlock: ReturnType<typeof vi.fn>;
    }) => unknown
  ) => {
    const state = { enableAdBlock: true, setEnableAdBlock: vi.fn() };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/components/auth", () => ({
  AccountConnect: () => <div data-testid="account-connect">accounts</div>,
}));

import { SettingsPage } from "@/pages/Settings";

const NAVIGATION_GROUPS = [
  {
    name: "Viewing",
    destinations: ["Playback", "Player controls", "Buffer", "Multiview"],
  },
  {
    name: "Experience",
    destinations: ["Notifications", "Chat", "Predictions"],
  },
  {
    name: "Accounts & Network",
    destinations: ["Integrations", "API / Tokens", "Ad-Block", "Proxy"],
  },
  {
    name: "System & Support",
    destinations: ["Updates", "Diagnostics", "About"],
  },
] as const;

function installDevEnvironment() {
  const api = installElectronAPIMock();
  const get = vi.fn(async () => ({
    isDev: true,
    platform: "win32" as NodeJS.Platform,
    appVersion: "1.0.0-test",
    electronVersion: "35.0.0",
    nodeVersion: "20.0.0",
  }));
  api.env.get = get;
  return get;
}

let environmentGet: ReturnType<typeof installDevEnvironment>;

async function settleEnvironmentProbe() {
  await waitFor(() => expect(environmentGet).toHaveBeenCalled());
  await act(async () => {
    await environmentGet.mock.results[0].value;
  });
}

function getRequestedSearch(call: unknown): Record<string, unknown> | undefined {
  const request = call as {
    search?:
      | Record<string, unknown>
      | ((previous: Record<string, unknown>) => Record<string, unknown>);
  };
  return typeof request.search === "function" ? request.search({}) : request.search;
}

// Guards: settings destinations remain discoverable under four plain-language navigation groups.
// Guards: the Settings sidebar exposes a named navigation landmark and identifies its active destination.
// Guards: selecting a destination writes the tab choice to the URL so refresh and sharing preserve context.
// Guards: a `?tab=` deep-link selects both the requested content and its matching navigation item.
// Guards: a later URL history change overrides any optimistic in-flight selection immediately.
describe("SettingsPage navigation", () => {
  beforeEach(() => {
    routerState.search = { tab: "playback" };
    routerState.navigate.mockReset();
    updatePreferences.mockReset();
    environmentGet = installDevEnvironment();
  });

  it("groups every destination in an accessible, URL-backed navigation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await settleEnvironmentProbe();

    const navigation = screen.getByRole("navigation", { name: "Settings navigation" });

    for (const group of NAVIGATION_GROUPS) {
      expect(within(navigation).getByRole("heading", { name: group.name })).toBeInTheDocument();
      for (const destination of group.destinations) {
        expect(
          within(navigation).getByRole("link", {
            name: new RegExp(`^${destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
          })
        ).toBeInTheDocument();
      }
    }

    expect(within(navigation).getByRole("link", { name: /^Playback\b/i })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(navigation).getByRole("link", { name: /^Chat\b/i })).not.toHaveAttribute(
      "aria-current"
    );

    await user.click(within(navigation).getByRole("link", { name: /^Chat\b/i }));

    expect(routerState.navigate).toHaveBeenCalledTimes(1);
    expect(getRequestedSearch(routerState.navigate.mock.calls[0][0])).toEqual(
      expect.objectContaining({ tab: "chat" })
    );
  });

  it("keeps a deep-linked tab active in both navigation and content", async () => {
    routerState.search = { tab: "chat" };

    renderWithProviders(<SettingsPage />);
    await settleEnvironmentProbe();

    const navigation = screen.getByRole("navigation", { name: "Settings navigation" });
    expect(within(navigation).getByRole("link", { name: /^Chat\b/i })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Emotes & badges")).toBeInTheDocument();
    expect(screen.getByText("Behavior")).toBeInTheDocument();
  });

  it("lets a later URL history change override an optimistic selection", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<SettingsPage />);
    await settleEnvironmentProbe();
    const navigation = screen.getByRole("navigation", { name: "Settings navigation" });

    await user.click(within(navigation).getByRole("link", { name: /^Chat\b/i }));
    expect(within(navigation).getByRole("link", { name: /^Chat\b/i })).toHaveAttribute(
      "aria-current",
      "page"
    );

    routerState.search = { tab: "buffer" };
    rerender(<SettingsPage />);

    expect(within(navigation).getByRole("link", { name: /^Buffer\b/i })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(within(navigation).getByRole("link", { name: /^Chat\b/i })).not.toHaveAttribute(
      "aria-current"
    );
    expect(screen.getByRole("heading", { level: 2, name: "Buffer" })).toBeInTheDocument();
  });
});
