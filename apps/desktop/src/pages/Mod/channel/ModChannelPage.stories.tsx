import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import { expect, within } from "storybook/test";

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import type { ElectronAPI } from "@/preload";
import {
  KICK_APP_SCOPES,
  type KickUser,
  TWITCH_APP_SCOPES,
  type TwitchUser,
} from "@/shared/auth-types";
import type { ModLogEntry } from "@/shared/mod-log-types";
import type {
  TwitchBannedUser,
  TwitchChannelMember,
  TwitchPoll,
  TwitchPrediction,
  TwitchUnbanRequest,
} from "@/shared/twitch-api-types";
import { useAuthStore } from "@/store/auth-store";
import { useDevModOverrideStore } from "@/store/dev-mod-override-store";
import { useModeratedChannelsStore } from "@/store/moderated-channels-store";

import { ModChannelPage } from "./ModChannelPage";

type PageState =
  | "twitch-resolving"
  | "twitch-resolve-failed"
  | "twitch-broadcaster-ready"
  | "twitch-moderator-ready"
  | "kick-resolving"
  | "kick-resolve-failed"
  | "kick-broadcaster-ready"
  | "authority-hidden"
  | "authority-unverifiable"
  | "reconnect-required";
type ModChannelPageStoryArgs = ComponentProps<typeof ModChannelPage> & { fixtureState: PageState };

const TWITCH_CHANNEL_ID = "story-twitch-channel";
const TWITCH_CHANNEL_LOGIN = "novaarcade";
const KICK_CHANNEL_ID = "2048";
const KICK_CHANNEL_SLUG = "miramakes";
const storybookElectronApi = window.electronAPI;

const twitchBroadcaster = {
  id: TWITCH_CHANNEL_ID,
  login: TWITCH_CHANNEL_LOGIN,
  displayName: "NovaArcade",
  profileImageUrl: "",
  createdAt: "2026-08-10T12:00:00.000Z",
  broadcasterType: "partner",
} satisfies TwitchUser;

const twitchModerator = {
  id: "story-twitch-moderator",
  login: "mira_mods",
  displayName: "Mira Mods",
  profileImageUrl: "",
  createdAt: "2026-08-10T12:15:00.000Z",
  broadcasterType: "",
} satisfies TwitchUser;

const kickBroadcaster = {
  id: Number(KICK_CHANNEL_ID),
  username: "MiraMakes",
  slug: KICK_CHANNEL_SLUG,
  profilePic: "",
  verified: true,
} satisfies KickUser;

const kickChannel = {
  id: KICK_CHANNEL_ID,
  platform: "kick",
  username: KICK_CHANNEL_SLUG,
  displayName: "MiraMakes",
  avatarUrl: "",
  isLive: true,
  isVerified: true,
  isPartner: true,
} satisfies UnifiedChannel;

const modLogEntry = {
  id: 501,
  platform: "twitch",
  channelId: TWITCH_CHANNEL_ID,
  channelSlug: TWITCH_CHANNEL_LOGIN,
  action: "timeout",
  targetUserId: "story-target-orbit",
  targetUsername: "Orbit Owl",
  moderatorUserId: twitchModerator.id,
  moderatorUsername: twitchModerator.displayName,
  durationSeconds: 600,
  reason: "Repeated spoilers after a warning",
  provenance: "twitch-eventsub",
  providerEventId: "story-event-501",
  occurredAt: Date.UTC(2026, 7, 10, 18, 0),
  observedAt: Date.UTC(2026, 7, 10, 18, 0, 2),
  createdAt: Date.UTC(2026, 7, 10, 18, 0),
} satisfies ModLogEntry;

const bannedUsers = [
  {
    user_id: "story-banned-user",
    user_login: "orbit_owl",
    user_name: "Orbit Owl",
    expires_at: "",
    created_at: "2026-08-10T17:45:00.000Z",
    reason: "Repeated harassment",
    moderator_id: twitchModerator.id,
    moderator_login: twitchModerator.login,
    moderator_name: twitchModerator.displayName,
  },
] satisfies TwitchBannedUser[];

const unbanRequests = [
  {
    id: "story-unban-request",
    broadcaster_id: TWITCH_CHANNEL_ID,
    broadcaster_login: TWITCH_CHANNEL_LOGIN,
    broadcaster_name: twitchBroadcaster.displayName,
    moderator_id: null,
    moderator_login: null,
    moderator_name: null,
    user_id: "story-requester",
    user_login: "lumen_lark",
    user_name: "Lumen Lark",
    text: "I understand the rule and will not repeat the behavior.",
    status: "pending",
    created_at: "2026-08-10T17:30:00.000Z",
    resolved_at: null,
    resolution_text: null,
  },
] satisfies TwitchUnbanRequest[];

const moderatorEntries = [
  { user_id: twitchModerator.id, user_login: twitchModerator.login, user_name: "Mira Mods" },
] satisfies TwitchChannelMember[];

const vipEntries = [
  { user_id: "story-vip", user_login: "pixel_piper", user_name: "Pixel Piper" },
] satisfies TwitchChannelMember[];

const activePrediction = {
  id: "story-prediction",
  title: "Will NovaArcade complete the run?",
  outcomes: [
    { id: "prediction-yes", title: "Finish", users: 148, channel_points: 72_500 },
    { id: "prediction-no", title: "Reset", users: 86, channel_points: 41_200 },
  ],
  status: "ACTIVE",
  prediction_window: 300,
  created_at: "2026-08-10T18:00:00.000Z",
  ended_at: null,
  locked_at: null,
  winning_outcome_id: null,
} satisfies TwitchPrediction;

const activePoll = {
  id: "story-poll",
  title: "Which route next?",
  choices: [
    { id: "poll-safe", title: "Safe route", votes: 1_248 },
    { id: "poll-risky", title: "Risky shortcut", votes: 936 },
  ],
  status: "ACTIVE",
  duration: 120,
  started_at: "2026-08-10T18:02:00.000Z",
  ended_at: null,
} satisfies TwitchPoll;

function neverResolves(): Promise<never> {
  return new Promise(() => undefined);
}

function platformFor(state: PageState): "twitch" | "kick" {
  return state.startsWith("kick-") ? "kick" : "twitch";
}

function channelFor(state: PageState): string {
  return platformFor(state) === "kick" ? KICK_CHANNEL_SLUG : TWITCH_CHANNEL_LOGIN;
}

function createTwitchBridge(state: PageState): ElectronAPI["twitch"] {
  return {
    execute: async (command) => {
      if (command.operation === "resolve-channel") {
        if (state === "twitch-resolving") return neverResolves();
        if (state === "twitch-resolve-failed") {
          return {
            ok: false,
            kind: "unavailable",
            error: { code: "unavailable", message: "Twitch resolution failed in this fixture." },
          };
        }
        return {
          ok: true,
          data: {
            id: TWITCH_CHANNEL_ID,
            login: TWITCH_CHANNEL_LOGIN,
            displayName: twitchBroadcaster.displayName,
          },
        };
      }
      if (command.operation === "get-banned-users") {
        return { ok: true, data: { data: bannedUsers } };
      }
      if (command.operation === "get-unban-requests") {
        return { ok: true, data: { data: unbanRequests } };
      }
      if (command.operation === "get-moderators") {
        return { ok: true, data: { data: moderatorEntries, pagination: {} } };
      }
      if (command.operation === "get-vips") {
        return { ok: true, data: { data: vipEntries, pagination: {} } };
      }
      if (command.operation === "get-predictions") {
        return { ok: true, data: { data: [activePrediction] } };
      }
      if (command.operation === "get-polls") {
        return { ok: true, data: { data: [activePoll] } };
      }
      return { ok: true, data: null };
    },
    eventSub: storybookElectronApi.twitch.eventSub,
  };
}

function installPageBridge(state: PageState): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
  const electronApi = Object.create(storybookElectronApi) as ElectronAPI;
  const auth = Object.create(storybookElectronApi.auth) as ElectronAPI["auth"];
  const channels = Object.create(storybookElectronApi.channels) as ElectronAPI["channels"];
  const reconnectRequired = state === "reconnect-required";

  Object.defineProperty(auth, "tokenStatus", {
    configurable: true,
    value: async (platform: "twitch" | "kick") => ({
      platform,
      connected: true,
      valid: true,
      login: platform === "twitch" ? twitchBroadcaster.login : kickBroadcaster.slug,
      userId:
        platform === "twitch"
          ? state === "twitch-moderator-ready"
            ? twitchModerator.id
            : twitchBroadcaster.id
          : String(kickBroadcaster.id),
      scopes:
        platform === "twitch"
          ? reconnectRequired
            ? TWITCH_APP_SCOPES.slice(0, -1)
            : [...TWITCH_APP_SCOPES]
          : [...KICK_APP_SCOPES],
      expiresAt: Date.UTC(2027, 7, 10),
    }),
  });
  Object.defineProperty(channels, "getByUsername", {
    configurable: true,
    value: async () => {
      if (state === "kick-resolving") return neverResolves();
      if (state === "kick-resolve-failed") {
        return { success: false, error: "Kick resolution failed in this fixture." };
      }
      return { success: true, data: kickChannel };
    },
  });
  Object.defineProperties(electronApi, {
    auth: { configurable: true, value: auth },
    channels: { configurable: true, value: channels },
    twitch: { configurable: true, value: createTwitchBridge(state) },
    modLog: {
      configurable: true,
      value: {
        ...storybookElectronApi.modLog,
        query: async () => ({
          state: "ready" as const,
          entries: [
            platformFor(state) === "kick"
              ? {
                  ...modLogEntry,
                  platform: "kick" as const,
                  channelId: KICK_CHANNEL_ID,
                  channelSlug: KICK_CHANNEL_SLUG,
                }
              : modLogEntry,
          ],
          coverage: "complete" as const,
        }),
      },
    },
    retention: {
      configurable: true,
      value: {
        get: async (scope: string) => (scope === "global" ? 90 : 30),
        set: async () => undefined,
      },
    },
  });
  Object.defineProperty(window, "electronAPI", { configurable: true, value: electronApi });

  return () => {
    if (previousDescriptor) Object.defineProperty(window, "electronAPI", previousDescriptor);
    else Reflect.deleteProperty(window, "electronAPI");
  };
}

function installPageStores(state: PageState): () => void {
  const previousAuthState = useAuthStore.getState();
  const previousModeratedChannelsState = useModeratedChannelsStore.getState();
  const previousDevOverrideState = useDevModOverrideStore.getState();
  const isKick = platformFor(state) === "kick";
  const isHidden = state === "authority-hidden";
  const isModerator = state === "twitch-moderator-ready" || state === "authority-unverifiable";

  useAuthStore.setState({
    twitchUser: isKick || isHidden ? null : isModerator ? twitchModerator : twitchBroadcaster,
    twitchConnected: !isKick && !isHidden,
    twitchReconnectRequired: false,
    kickUser: isKick ? kickBroadcaster : null,
    kickConnected: isKick,
    isGuest: isHidden,
  });
  useModeratedChannelsStore.setState({
    twitchModeratedChannelIds:
      state === "twitch-moderator-ready" ? new Set([TWITCH_CHANNEL_ID]) : new Set(),
    twitchAuthority:
      state === "authority-unverifiable"
        ? { state: "failed", checkedAt: Date.now(), reason: "network" }
        : isModerator
          ? { state: "complete", checkedAt: Date.now() }
          : { state: "idle" },
    kickAuthorityBySlug: new Map(),
  });
  useDevModOverrideStore.setState({
    forceModRole: false,
    forceModScopes: false,
    forceResolvedTwitchBroadcasterId: "",
    forceBroadcasterIdentity: false,
  });

  return () => {
    useAuthStore.setState(previousAuthState, true);
    useModeratedChannelsStore.setState(previousModeratedChannelsState, true);
    useDevModOverrideStore.setState(previousDevOverrideState, true);
  };
}

function createStoryQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

function createPageRouter(state: PageState) {
  const platform = platformFor(state);
  const channel = channelFor(state);
  const rootRoute = createRootRoute({ component: Outlet });
  const modIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/mod",
    component: () => <div>Moderation index fixture</div>,
  });
  const channelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/mod/$platform/$channel",
    component: () => <ModChannelPage platform={platform} channel={channel} />,
  });

  return createRouter({
    routeTree: rootRoute.addChildren([modIndexRoute, channelRoute]),
    history: createMemoryHistory({ initialEntries: [`/mod/${platform}/${channel}`] }),
    defaultPendingMinMs: 0,
  });
}

function installPageFixtures(state: PageState): () => void {
  const restoreBridge = installPageBridge(state);
  const restoreStores = installPageStores(state);

  return () => {
    restoreStores();
    restoreBridge();
  };
}

function PageQueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createStoryQueryClient);

  useEffect(() => () => queryClient.clear(), [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function ModChannelPageStoryCanvas({ state }: { state: PageState }) {
  const [router] = useState(() => createPageRouter(state));

  return (
    <PageQueryProvider>
      <div className="h-[900px] min-w-[760px] bg-[var(--color-background)]">
        <RouterProvider router={router} />
      </div>
    </PageQueryProvider>
  );
}

const meta = {
  title: "Pages/Moderation/Channel/ModChannelPage",
  component: ModChannelPage,
  args: {
    platform: "twitch",
    channel: TWITCH_CHANNEL_LOGIN,
    fixtureState: "twitch-resolving",
  },
  beforeEach: ({ args }) => installPageFixtures(args.fixtureState),
  render: ({ fixtureState }) => <ModChannelPageStoryCanvas state={fixtureState} />,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The full per-channel moderation shell across Twitch and Kick, including channel resolution, authority gates, and assembled ready content. Fixed router, store, React Query, and Electron bridge fixtures prevent live API or IPC calls.",
      },
    },
  },
} satisfies Meta<ModChannelPageStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwitchChannelResolving: Story = {
  args: { fixtureState: "twitch-resolving" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("mod-channel-resolving")).toHaveTextContent(
      "Resolving channel"
    );
    await expect(canvas.getByTestId("mod-channel-platform-pill")).toHaveTextContent("Twitch");
  },
};

export const TwitchChannelResolutionFailed: Story = {
  args: { fixtureState: "twitch-resolve-failed" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId("mod-channel-resolve-failed")
    ).toHaveTextContent(`Couldn't resolve Twitch channel "${TWITCH_CHANNEL_LOGIN}".`);
  },
};

export const TwitchBroadcasterReady: Story = {
  args: { fixtureState: "twitch-broadcaster-ready" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("mod-channel-heading")).toHaveTextContent(
      twitchBroadcaster.displayName
    );
    await expect(await canvas.findByTestId("channel-mod-log-feed")).toBeInTheDocument();
    await expect(await canvas.findByTestId("channel-engagement-prediction")).toBeInTheDocument();
    await expect(await canvas.findByTestId("channel-unban-requests-results")).toBeInTheDocument();
    await expect(await canvas.findByTestId("channel-moderators-results")).toBeInTheDocument();
    await expect(await canvas.findByTestId("channel-vips-results")).toBeInTheDocument();
    await expect(await canvas.findByTestId("channel-banned-list-results")).toBeInTheDocument();
  },
};

export const TwitchModeratorReady: Story = {
  args: { fixtureState: "twitch-moderator-ready" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("channel-mod-log-feed")).toBeInTheDocument();
    await expect(await canvas.findByTestId("channel-unban-requests")).toBeInTheDocument();
    await expect(await canvas.findByTestId("channel-banned-list")).toBeInTheDocument();
    await expect(canvas.queryByTestId("channel-engagement")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("channel-moderators-table")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("channel-vips-table")).not.toBeInTheDocument();
  },
};

export const KickChannelResolving: Story = {
  args: { fixtureState: "kick-resolving" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("mod-channel-resolving")).toBeInTheDocument();
    await expect(canvas.getByTestId("mod-channel-platform-pill")).toHaveTextContent("Kick");
  },
};

export const KickChannelResolutionFailed: Story = {
  args: { fixtureState: "kick-resolve-failed" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId("mod-channel-resolve-failed")
    ).toHaveTextContent(`Couldn't resolve Kick channel "${KICK_CHANNEL_SLUG}".`);
  },
};

export const KickBroadcasterReady: Story = {
  args: { fixtureState: "kick-broadcaster-ready" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("retention-card-channel:kick:2048")).toBeInTheDocument();
    await expect(await canvas.findByTestId("channel-mod-log-feed")).toBeInTheDocument();
    await expect(await canvas.findByTestId("channel-banned-list-kick")).toHaveTextContent(
      "Kick doesn't expose a public banned-users list endpoint."
    );
    await expect(canvas.queryByTestId("channel-unban-requests")).not.toBeInTheDocument();
  },
};

export const ModerationAccessRequired: Story = {
  args: { fixtureState: "authority-hidden" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId("mod-channel-authority-hidden")
    ).toHaveTextContent("Moderation access required");
  },
};

export const AuthorityUnavailable: Story = {
  args: { fixtureState: "authority-unverifiable" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("mod-channel-authority-unverifiable")).toHaveTextContent(
      "Couldn't verify moderation access"
    );
    await expect(canvas.getByRole("button", { name: "Retry" })).toBeEnabled();
  },
};

export const MissingPermissionsRequireReconnect: Story = {
  args: { fixtureState: "reconnect-required" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("mod-channel-reconnect-required")).toHaveTextContent(
      "Reconnect Twitch"
    );
    await expect(canvas.getByRole("button", { name: "Reconnect Twitch" })).toBeEnabled();
  },
};
