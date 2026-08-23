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
import { expect, within } from "storybook/test";

import type { ElectronAPI } from "@/preload";
import type { KickUser, TwitchUser } from "@/shared/auth-types";
import type { ModeratedTwitchChannel, TwitchApiResult } from "@/shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";

import { ChannelList } from "./ChannelList";

type ChannelListState = "empty" | "populated" | "pending" | "failed";
type ChannelListStoryArgs = { fixtureState: ChannelListState };

const storybookElectronApi = window.electronAPI;

const twitchUser: TwitchUser = {
  id: "story-twitch-user",
  login: "novaarcade",
  displayName: "NovaArcade",
  profileImageUrl: "",
  createdAt: "2026-08-10T12:00:00.000Z",
  broadcasterType: "partner",
};

const kickUser: KickUser = {
  id: 2048,
  username: "MiraMakes",
  slug: "miramakes",
  profilePic: "",
  verified: true,
};

const moderatedChannels: ModeratedTwitchChannel[] = [
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
];

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function moderationResult(state: ChannelListState): Promise<TwitchApiResult> {
  if (state === "pending") return neverResolves();
  if (state === "failed") {
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

function installChannelListBridge(state: ChannelListState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const electronApi = Object.create(storybookElectronApi) as ElectronAPI;
  const twitch = Object.create(storybookElectronApi.twitch) as ElectronAPI["twitch"];
  Object.defineProperty(twitch, "execute", {
    configurable: true,
    value: () => moderationResult(state),
  });
  Object.defineProperty(electronApi, "twitch", {
    configurable: true,
    value: twitch,
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

function createChannelListRouter() {
  const rootRoute = createRootRoute({ component: Outlet });
  const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "_app", component: Outlet });
  const modRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/mod",
    component: ChannelList,
  });
  const twitchChannelRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/mod/twitch/$channel",
    component: () => <div>Twitch moderation route fixture</div>,
  });
  const kickChannelRoute = createRoute({
    getParentRoute: () => appRoute,
    path: "/mod/kick/$channel",
    component: () => <div>Kick moderation route fixture</div>,
  });

  return createRouter({
    routeTree: rootRoute.addChildren([
      appRoute.addChildren([modRoute, twitchChannelRoute, kickChannelRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: ["/mod"] }),
    defaultPendingMinMs: 0,
  });
}

function installChannelListFixtures(state: ChannelListState): () => void {
  const previousAuthState = useAuthStore.getState();
  useAuthStore.setState({
    twitchUser: state === "empty" ? null : twitchUser,
    twitchConnected: state !== "empty",
    kickUser: state === "populated" ? kickUser : null,
    kickConnected: state === "populated",
    isGuest: state === "empty",
  });
  const restoreBridge = installChannelListBridge(state);

  return () => {
    restoreBridge();
    useAuthStore.setState(previousAuthState, true);
  };
}

function ChannelListStoryCanvas() {
  const [router] = useState(createChannelListRouter);

  return (
    <div className="min-h-[420px] min-w-[720px] bg-[var(--color-background)] p-6">
      <RouterProvider router={router} />
    </div>
  );
}

const meta = {
  title: "Pages/Moderation/ChannelList",
  component: ChannelList,
  args: { fixtureState: "empty" },
  beforeEach: ({ args }) => installChannelListFixtures(args.fixtureState),
  render: () => <ChannelListStoryCanvas />,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Moderated-channel discovery in a memory router with seeded auth and a local Electron bridge fixture. Stories never call platform APIs or live IPC.",
      },
    },
  },
} satisfies Meta<ChannelListStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EmptySignedOut: Story = {
  args: { fixtureState: "empty" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("You don't moderate any channels yet.")
    ).toBeInTheDocument();
  },
};

export const Populated: Story = {
  args: { fixtureState: "populated" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("NovaArcade")).toBeInTheDocument();
    await expect(await canvas.findByText("Rift Runner")).toBeInTheDocument();
    await expect(await canvas.findByText("Lumen Lab")).toBeInTheDocument();
    await expect(canvas.getByText("MiraMakes")).toBeInTheDocument();
  },
};

export const ModerationDiscoveryPending: Story = {
  args: { fixtureState: "pending" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("NovaArcade")).toBeInTheDocument();
    await expect(canvas.getByTestId("mod-channel-list-grid")).toBeInTheDocument();
  },
};

export const FailedDiscovery: Story = {
  args: { fixtureState: "failed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("NovaArcade")).toBeInTheDocument();
    await expect(canvas.queryByText("Rift Runner")).not.toBeInTheDocument();
  },
};
