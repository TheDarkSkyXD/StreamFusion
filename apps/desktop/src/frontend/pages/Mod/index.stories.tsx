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
import { expect, userEvent, waitFor, within } from "storybook/test";

import type { ElectronAPI } from "@backend/preload";
import type { KickUser, TwitchUser } from "@shared/auth-types";
import type { ModeratedTwitchChannel, TwitchApiResult } from "@shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";
import { useModeratedChannelsStore } from "@/features/moderation/data/moderated-channels-store";

import { ModPage } from "./index";

type ModPageState = "empty" | "populated" | "loading" | "permission-denied" | "unavailable";
type ModPageStoryArgs = { fixtureState: ModPageState };

const storybookElectronApi = window.electronAPI;

const twitchUser = {
  id: "story-twitch-user",
  login: "novaarcade",
  displayName: "NovaArcade",
  profileImageUrl: "",
  createdAt: "2026-08-10T12:00:00.000Z",
  broadcasterType: "partner",
} satisfies TwitchUser;

const kickUser = {
  id: 2048,
  username: "MiraMakes",
  slug: "miramakes",
  profilePic: "",
  verified: true,
} satisfies KickUser;

const moderatedChannels = [
  {
    broadcaster_id: "story-channel-1",
    broadcaster_login: "rift_runner",
    broadcaster_name: "Rift Runner",
  },
  {
    broadcaster_id: "story-channel-2",
    broadcaster_login: "lumen_lab",
    broadcaster_name: "Lumen Lab",
  },
] satisfies ModeratedTwitchChannel[];

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function moderatedChannelsResult(state: ModPageState): Promise<TwitchApiResult> {
  if (state === "loading") return neverResolves();
  if (state === "permission-denied") {
    return Promise.resolve({
      ok: false,
      kind: "unauthorized",
      error: {
        code: "unauthorized",
        message: "Moderated-channel discovery needs additional permission in this fixture.",
      },
    });
  }
  if (state === "unavailable") {
    return Promise.resolve({
      ok: false,
      kind: "unavailable",
      error: {
        code: "unavailable",
        message: "Moderated-channel discovery is unavailable in this fixture.",
      },
    });
  }
  return Promise.resolve({ ok: true, data: moderatedChannels });
}

function installModPageBridge(state: ModPageState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const electronApi = Object.create(storybookElectronApi) as ElectronAPI;
  const twitch = Object.create(storybookElectronApi.twitch) as ElectronAPI["twitch"];

  Object.defineProperty(twitch, "execute", {
    configurable: true,
    value: () => moderatedChannelsResult(state),
  });
  Object.defineProperties(electronApi, {
    twitch: { configurable: true, value: twitch },
    retention: {
      configurable: true,
      value: {
        get: async () => (state === "empty" ? undefined : 30),
        set: async () => undefined,
      } satisfies ElectronAPI["retention"],
    },
  });
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: electronApi,
  });

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(window, "electronAPI", previousDescriptor);
    } else {
      Reflect.deleteProperty(window, "electronAPI");
    }
  };
}

function installModPageStores(state: ModPageState): () => void {
  const previousAuthState = useAuthStore.getState();
  const previousModeratedChannelsState = useModeratedChannelsStore.getState();
  const signedIn = state !== "empty";
  const fullyPopulated = state === "populated";

  useAuthStore.setState({
    twitchUser: signedIn ? twitchUser : null,
    twitchConnected: signedIn,
    twitchLoading: false,
    twitchReconnectRequired: false,
    kickUser: fullyPopulated ? kickUser : null,
    kickConnected: fullyPopulated,
    kickLoading: false,
    isGuest: !signedIn,
    error: null,
    initialized: true,
  });
  useModeratedChannelsStore.setState({
    twitchModeratedChannelIds: new Set<string>(),
    kickModeratedChannelSlugs: new Set<string>(),
    hydratedAt: null,
    hydrating: false,
    twitchAuthority: { state: "idle" },
    kickAuthorityBySlug: new Map(),
  });

  return () => {
    useModeratedChannelsStore.setState(previousModeratedChannelsState, true);
    useAuthStore.setState(previousAuthState, true);
  };
}

function createModPageRouter() {
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "_app",
    component: Outlet,
  });
  const modRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/mod",
    component: ModPage,
  });
  const twitchChannelRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/mod/twitch/$channel",
    component: () => (
      <div className="p-6 text-white" data-testid="twitch-moderation-destination">
        Twitch moderation route fixture
      </div>
    ),
  });
  const kickChannelRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/mod/kick/$channel",
    component: () => (
      <div className="p-6 text-white" data-testid="kick-moderation-destination">
        Kick moderation route fixture
      </div>
    ),
  });

  return createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([modRoute, twitchChannelRoute, kickChannelRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/mod"] }),
    defaultPendingMinMs: 0,
  });
}

function installModPageFixtures(state: ModPageState): () => void {
  const restoreBridge = installModPageBridge(state);
  const restoreStores = installModPageStores(state);

  return () => {
    restoreStores();
    restoreBridge();
  };
}

function ModPageStoryCanvas() {
  const [router] = useState(createModPageRouter);

  return (
    <div className="h-[720px] min-w-[760px] bg-[var(--color-background)]">
      <RouterProvider router={router} />
    </div>
  );
}

const meta = {
  title: "Pages/Moderation/ModPage",
  component: ModPage,
  args: { fixtureState: "empty" },
  beforeEach: ({ args }) => installModPageFixtures(args.fixtureState),
  render: () => <ModPageStoryCanvas />,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The moderation landing page with deterministic auth, moderation-store, router, retention, and channel-discovery fixtures. No story calls live platform APIs or Electron IPC.",
      },
    },
  },
} satisfies Meta<ModPageStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptySignedOut: Story = {
  args: { fixtureState: "empty" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("mod-channel-list-empty")).toHaveTextContent(
      "You don't moderate any channels yet."
    );
    await expect(canvas.getByTestId("global-retention")).toBeInTheDocument();
    await expect(
      await canvas.findByRole("spinbutton", { name: "Retention days for Global (default)" })
    ).toHaveValue(null);
  },
};

export const Populated: Story = {
  args: { fixtureState: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("NovaArcade")).toBeInTheDocument();
    await expect(canvas.getByText("Rift Runner")).toBeInTheDocument();
    await expect(canvas.getByText("Lumen Lab")).toBeInTheDocument();
    await expect(canvas.getByText("MiraMakes")).toBeInTheDocument();
    await expect(
      await canvas.findByRole("spinbutton", { name: "Retention days for Global (default)" })
    ).toHaveValue(30);
  },
};

export const ModeratedChannelsLoading: Story = {
  args: { fixtureState: "loading" },
  parameters: {
    docs: {
      description: {
        story:
          "Remote moderated-channel discovery is still pending. The broadcaster's own channel and global retention remain available, matching the page's non-blocking loading behavior.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("mod-channel-card-twitch-novaarcade")
    ).toBeInTheDocument();
    await expect(canvas.queryByText("Rift Runner")).not.toBeInTheDocument();
    await expect(canvas.getByTestId("global-retention")).toBeInTheDocument();
  },
};

export const MissingDiscoveryPermission: Story = {
  args: { fixtureState: "permission-denied" },
  parameters: {
    docs: {
      description: {
        story:
          "Twitch rejects cross-channel discovery for missing permission. The index intentionally keeps the broadcaster's own channel visible and does not invent an error alert.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("mod-channel-card-twitch-novaarcade")
    ).toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByText("Rift Runner")).not.toBeInTheDocument());
    await expect(canvas.getByTestId("global-retention")).toBeInTheDocument();
  },
};

export const DiscoveryUnavailableFallback: Story = {
  args: { fixtureState: "unavailable" },
  parameters: {
    docs: {
      description: {
        story:
          "An unavailable discovery service degrades to the signed-in broadcaster's own channel while the rest of the page remains usable.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByTestId("mod-channel-card-twitch-novaarcade")
    ).toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByText("Rift Runner")).not.toBeInTheDocument());
    await expect(canvas.getByRole("button", { name: "Refresh moderation data" })).toBeEnabled();
  },
};

export const NavigateToTwitchChannel: Story = {
  args: { fixtureState: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("mod-channel-card-twitch-rift_runner"));
    await expect(await canvas.findByTestId("twitch-moderation-destination")).toHaveTextContent(
      "Twitch moderation route fixture"
    );
  },
};

export const NavigateToKickChannel: Story = {
  args: { fixtureState: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId("mod-channel-card-kick-miramakes"));
    await expect(await canvas.findByTestId("kick-moderation-destination")).toHaveTextContent(
      "Kick moderation route fixture"
    );
  },
};

export const RefreshesModerationData: Story = {
  args: { fixtureState: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Rift Runner");
    await userEvent.click(canvas.getByRole("button", { name: "Refresh moderation data" }));
    await waitFor(() => {
      expect(useModeratedChannelsStore.getState().twitchAuthority.state).toBe("complete");
      expect(useModeratedChannelsStore.getState().twitchModeratedChannelIds).toEqual(
        new Set(["story-channel-1", "story-channel-2"])
      );
    });
  },
};
