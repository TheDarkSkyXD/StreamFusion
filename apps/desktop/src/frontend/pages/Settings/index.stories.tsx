import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import type { UnifiedChannel } from "@shared/platform-types";
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from "@shared/auth-types";
import { useAdBlockStore } from "@/store/adblock-store";
import { useAppStore } from "@/store/app-store";
import { useAuthStore } from "@/store/auth-store";
import { useFollowStore } from "@/store/follow-store";
import { useMultiStreamStore } from "@/features/multistream/data/multistream-store";
import { useSeekIntervalStore } from "@/store/seek-interval-store";
import { useUpdateStore } from "@/store/update-store";

import { SettingsPage } from "./index";

type SettingsState =
  "default" | "configured" | "empty" | "multiview-limit" | "proxy-error" | "invalid-tokens";

type SettingsBridge = {
  getVersion: () => Promise<string>;
  getVersionInfo: () => Promise<{
    version: string;
    isPrerelease: boolean;
    channel: "stable";
    displayVersion: string;
  }>;
  env: { get: () => Promise<{ isDev: boolean }> };
  notifications: { getCoverageStatus: () => Promise<unknown> };
  slot: { setBackgroundQuality: () => Promise<void> };
  proxy: {
    hasCredentials: () => Promise<{ hasCredentials: boolean }>;
    setCredentials: () => Promise<{ hasCredentials: boolean }>;
    apply: () => Promise<{
      applied: boolean;
      cleared: boolean;
      hasCredentials: boolean;
      error?: string;
    }>;
  };
  auth: { tokenStatus: (platform: "twitch" | "kick") => Promise<unknown> };
  updater: {
    getStatus: () => Promise<unknown>;
    onStatusChange: () => () => void;
    onProgress: () => () => void;
    check: () => Promise<unknown>;
    download: () => Promise<unknown>;
    install: () => Promise<void>;
    setAllowPrerelease: (allow: boolean) => Promise<{ allowPrerelease: boolean }>;
    setAutoCheck: (settings: {
      enabled?: boolean;
      frequency?: "hourly" | "daily" | "weekly";
    }) => Promise<{ autoCheckEnabled: boolean; checkFrequency: "hourly" | "daily" | "weekly" }>;
  };
};

const followedChannels: UnifiedChannel[] = [
  {
    id: "story-twitch-lumen",
    platform: "twitch",
    username: "lumenlab",
    displayName: "Lumen Lab",
    avatarUrl: "",
    bannerUrl: "",
    bio: "",
    isLive: true,
    isVerified: true,
    isPartner: true,
  },
  {
    id: "story-kick-harbor",
    platform: "kick",
    username: "harborhours",
    displayName: "Harbor Hours",
    avatarUrl: "",
    bannerUrl: "",
    bio: "",
    isLive: false,
    isVerified: false,
    isPartner: false,
  },
];

function configuredPreferences(): UserPreferences {
  return {
    ...DEFAULT_USER_PREFERENCES,
    playback: { ...DEFAULT_USER_PREFERENCES.playback, defaultQuality: "1080p" },
    notifications: {
      ...DEFAULT_USER_PREFERENCES.notifications,
      enabled: true,
      favoriteChannelsOnly: true,
      restartGracePeriodMinutes: 15,
      perChannelNotifications: {
        "twitch:story-twitch-lumen": true,
        "kick:story-kick-harbor": false,
      },
    },
    proxy: {
      enabled: true,
      host: "proxy.streamfusion.test",
      port: 8443,
      hasCredentials: true,
    },
  };
}

function installSettingsBridge(state: SettingsState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const proxyFailed = state === "proxy-error";
  const tokenInvalid = state === "invalid-tokens";
  const bridge: SettingsBridge = {
    getVersion: async () => "1.4.0-storybook",
    getVersionInfo: async () => ({
      version: "1.4.0-storybook",
      isPrerelease: false,
      channel: "stable",
      displayVersion: "1.4.0-storybook",
    }),
    env: { get: async () => ({ isDev: false }) },
    notifications: {
      getCoverageStatus: async () => ({
        desktop: { supported: true, permission: "granted" },
        platforms: {
          twitch: { status: "normal", issues: [] },
          kick: {
            status: state === "configured" ? "degraded" : "normal",
            issues:
              state === "configured"
                ? [
                    {
                      platform: "kick",
                      reason: "polling-limited",
                      message: "Kick live checks are temporarily rate limited.",
                      firstSeenAt: 0,
                      lastSeenAt: 0,
                    },
                  ]
                : [],
          },
        },
      }),
    },
    slot: { setBackgroundQuality: async () => undefined },
    proxy: {
      hasCredentials: async () => ({ hasCredentials: state === "configured" }),
      setCredentials: async () => ({ hasCredentials: state === "configured" }),
      apply: async () =>
        proxyFailed
          ? {
              applied: false,
              cleared: false,
              hasCredentials: false,
              error: "The proxy host could not be reached.",
            }
          : { applied: true, cleared: false, hasCredentials: state === "configured" },
    },
    auth: {
      tokenStatus: async (platform) =>
        tokenInvalid
          ? { platform, connected: true, valid: false }
          : {
              platform,
              connected: true,
              valid: true,
              login: platform === "twitch" ? "storybook" : "storybook-kick",
              userId: platform === "twitch" ? "story-twitch" : "101",
              expiresAt: 1_800_000_000_000,
              scopes: ["user:read"],
            },
    },
    updater: {
      getStatus: async () => ({
        status: "not-available",
        updateInfo: null,
        progress: null,
        error: null,
        allowPrerelease: false,
        autoCheckEnabled: true,
        checkFrequency: "weekly",
      }),
      onStatusChange: () => () => undefined,
      onProgress: () => () => undefined,
      check: async () => ({
        status: "not-available",
        updateInfo: null,
        error: null,
        allowPrerelease: false,
      }),
      download: async () => ({
        status: "downloaded",
        updateInfo: null,
        progress: null,
        error: null,
      }),
      install: async () => undefined,
      setAllowPrerelease: async (allowPrerelease) => ({ allowPrerelease }),
      setAutoCheck: async ({ enabled, frequency }) => ({
        autoCheckEnabled: enabled ?? true,
        checkFrequency: frequency ?? "weekly",
      }),
    },
  };

  Reflect.defineProperty(window, "electronAPI", {
    configurable: true,
    writable: true,
    value: bridge,
  });

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(window, "electronAPI", previousDescriptor);
      return;
    }
    Reflect.deleteProperty(window, "electronAPI");
  };
}

function installSettingsStores(state: SettingsState): () => void {
  const originalAuth = useAuthStore.getState();
  const originalFollows = useFollowStore.getState();
  const originalAdBlock = useAdBlockStore.getState();
  const originalApp = useAppStore.getState();
  const originalMultiview = useMultiStreamStore.getState();
  const originalSeekIntervals = useSeekIntervalStore.getState();
  const originalUpdate = useUpdateStore.getState();
  const preferences =
    state === "configured" || state === "proxy-error"
      ? configuredPreferences()
      : { ...DEFAULT_USER_PREFERENCES };

  useAuthStore.setState({
    preferences,
    error: null,
    updatePreferences: async (updates) => {
      useAuthStore.setState((current) => ({
        preferences: { ...(current.preferences ?? DEFAULT_USER_PREFERENCES), ...updates },
      }));
      return { success: true };
    },
  });
  useFollowStore.setState({
    localFollows: state === "configured" ? followedChannels : [],
    isHydrated: true,
    pendingAccountActions: [],
    sourceByKey: new Map(),
  });
  useAdBlockStore.setState({ enableAdBlock: true });
  useAppStore.setState({ homeCarouselIntervalMs: 30_000 });
  useMultiStreamStore.setState({
    streams:
      state === "multiview-limit"
        ? Array.from({ length: 6 }, (_, index) => ({
            id: `story-stream-${index + 1}`,
            platform: "twitch",
            channelName: `channel${index + 1}`,
            isMuted: index > 0,
            volume: 0.5,
          }))
        : [],
    playbackBudget: state === "multiview-limit" ? 6 : 4,
    backgroundQuality: state === "multiview-limit" ? "off" : "auto-low",
  });
  useSeekIntervalStore.setState({ rewindSeconds: 10, forwardSeconds: 10 });
  useUpdateStore.getState().reset();

  return () => {
    useUpdateStore.setState(originalUpdate, true);
    useSeekIntervalStore.setState(originalSeekIntervals, true);
    useMultiStreamStore.setState(originalMultiview, true);
    useAppStore.setState(originalApp, true);
    useAdBlockStore.setState(originalAdBlock, true);
    useFollowStore.setState(originalFollows, true);
    useAuthStore.setState(originalAuth, true);
  };
}

function installSettingsEnvironment(state: SettingsState): () => void {
  const restoreBridge = installSettingsBridge(state);
  const restoreStores = installSettingsStores(state);

  return () => {
    restoreStores();
    restoreBridge();
  };
}

function settingsPath(state: SettingsState): string {
  switch (state) {
    case "configured":
    case "empty":
      return "/settings?tab=notifications";
    case "multiview-limit":
      return "/settings?tab=multiview";
    case "proxy-error":
      return "/settings?tab=proxy";
    case "invalid-tokens":
      return "/settings?tab=api-tokens";
    default:
      return "/settings?tab=playback";
  }
}

function createSettingsRouter(state: SettingsState) {
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: Outlet });
  const settingsRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/settings",
    validateSearch: (search: Record<string, unknown>) => ({
      tab: typeof search.tab === "string" ? search.tab : undefined,
    }),
    component: () => (
      <div className="h-[840px] min-w-[1100px] overflow-hidden bg-[var(--color-background)]">
        <SettingsPage />
      </div>
    ),
  });

  return createRouter({
    routeTree: rootRoute.addChildren([appRoute.addChildren([settingsRoute])]),
    history: createMemoryHistory({ initialEntries: [settingsPath(state)] }),
    defaultPendingMinMs: 0,
  });
}

function SettingsStoryCanvas({ state }: { state: SettingsState }) {
  const [router] = useState(() => createSettingsRouter(state));

  return <RouterProvider router={router} />;
}

const meta = {
  title: "Pages/Settings/SettingsPage",
  component: SettingsPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The settings hub in an isolated memory router with deterministic Zustand and Electron bridge fixtures. Stories never use network, live IPC, HLS, or persisted user settings.",
      },
    },
  },
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach: () => installSettingsEnvironment("default"),
  render: () => <SettingsStoryCanvas state="default" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("heading", { name: "Playback" })
    ).toBeInTheDocument();
  },
};

export const ConfiguredNotifications: Story = {
  beforeEach: () => installSettingsEnvironment("configured"),
  render: () => <SettingsStoryCanvas state="configured" />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Lumen Lab")).toBeInTheDocument();
    await expect(
      within(canvasElement).getByText("Kick live checks are temporarily rate limited.")
    ).toBeInTheDocument();
  },
};

export const EmptyFollowedChannels: Story = {
  beforeEach: () => installSettingsEnvironment("empty"),
  render: () => <SettingsStoryCanvas state="empty" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("No followed channels yet.")
    ).toBeInTheDocument();
  },
};

export const MultiviewAtSupportedLimit: Story = {
  beforeEach: () => installSettingsEnvironment("multiview-limit"),
  render: () => <SettingsStoryCanvas state="multiview-limit" />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("6 streams")).toBeInTheDocument();
  },
};

export const ProxyApplyError: Story = {
  beforeEach: () => installSettingsEnvironment("proxy-error"),
  render: () => <SettingsStoryCanvas state="proxy-error" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Save & apply" }));
    await expect(await canvas.findByText("Couldn't apply the proxy")).toBeInTheDocument();
    await expect(canvas.getByText("The proxy host could not be reached.")).toBeInTheDocument();
  },
};

export const InvalidTokenStatus: Story = {
  beforeEach: () => installSettingsEnvironment("invalid-tokens"),
  render: () => <SettingsStoryCanvas state="invalid-tokens" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findAllByText("Token invalid or expired")
    ).toHaveLength(2);
  },
};
