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
import { expect, isMockFunction, spyOn, within } from "storybook/test";
import { KickLivePlayer } from "@/features/playback/components/player/kick/kick-live-player";
import { TwitchLivePlayer } from "@/features/playback/components/player/twitch/twitch-live-player";
import { ChatPanel } from "@/features/chat/components/chat/ChatPanel";

import type { UnifiedChannel } from "@shared/platform-types";
import type { ElectronAPI } from "@backend/preload";
import {
  KICK_APP_SCOPES,
  type KickUser,
  TWITCH_APP_SCOPES,
  type TwitchUser,
} from "@shared/auth-types";
import type { ModLogEntry } from "@shared/mod-log-types";
import type { StreamInfo, RewardRedemption } from "@shared/moderation-types";
import type {
  TwitchBannedUser,
  TwitchChannelMember,
  TwitchPoll,
  TwitchPrediction,
  TwitchUnbanRequest,
} from "@shared/twitch-api-types";
import { useAuthStore } from "@/features/auth/components/state/auth-store";
import { useDevModOverrideStore } from "@/features/moderation/components/state/dev-mod-override-store";
import { useModeratedChannelsStore } from "@/features/moderation/components/state/moderated-channels-store";

import { ModChannelPage } from "../../../../../components/screens/Mod/channel/ModChannelPage";

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

const TWITCH_CHANNEL_ID = "1002048";
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
  id: "1004096",
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
  kickChannelId: "2048",
  kickUserId: "2048",
  chatroomId: 4096,
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
  const eventListeners = new Set<Parameters<ElectronAPI["twitch"]["eventSub"]["onEvent"]>[0]>();
  const stateListeners = new Set<Parameters<ElectronAPI["twitch"]["eventSub"]["onState"]>[0]>();
  const stamp = new Date().toISOString();
  const identity = {
    id: twitchModerator.id,
    login: twitchModerator.login,
    displayName: twitchModerator.displayName,
  };
  let shield = false;
  let policy = {
    overallLevel: 2 as number | null,
    levels: {
      aggression: 2,
      bullying: 2,
      disability: 2,
      misogyny: 2,
      raceEthnicityOrReligion: 2,
      sexBasedTerms: 2,
      sexualitySexOrGender: 2,
      swearing: 2,
    },
  };
  let terms = [
    {
      id: "fixture-term",
      text: "example blocked phrase",
      createdAt: stamp,
      updatedAt: stamp,
      expiresAt: null,
    },
  ];
  let streamInfo: StreamInfo = {
    broadcasterId: TWITCH_CHANNEL_ID,
    title: "A relaxed creative stream",
    category: { id: "509658", name: "Just Chatting" },
    language: "en",
    tags: ["English", "Creative"],
    contentClassificationLabels: [],
    availableContentClassificationLabels: [
      {
        id: "ProfanityVulgarity",
        name: "Profanity or vulgarity",
        description: "Frequent strong language.",
      },
    ],
  };
  let redemptions: RewardRedemption[] = [
    {
      redemptionId: "fixture-redemption",
      rewardId: "fixture-reward",
      rewardTitle: "Read a poem",
      cost: 400,
      user: identity,
      input: "A poem about the stars, please.",
      status: "unfulfilled",
      redeemedAt: stamp,
    },
  ];
  return {
    execute: async (command) => {
      if (command.operation === "get-stream-info") return { ok: true, data: streamInfo };
      if (command.operation === "update-stream-info") {
        streamInfo = {
          ...streamInfo,
          ...(command.settings.title !== undefined ? { title: command.settings.title } : {}),
          ...(command.settings.language !== undefined
            ? { language: command.settings.language }
            : {}),
          ...(command.settings.tags !== undefined ? { tags: command.settings.tags } : {}),
          ...(command.settings.categoryId !== undefined
            ? { category: { id: command.settings.categoryId, name: "Fixture category" } }
            : {}),
        };
        for (const label of command.settings.contentClassificationLabels ?? [])
          streamInfo.contentClassificationLabels = label.enabled
            ? [...new Set([...streamInfo.contentClassificationLabels, label.id])]
            : streamInfo.contentClassificationLabels.filter((id) => id !== label.id);
        return { ok: true, data: { updated: true } };
      }
      if (command.operation === "get-shield-mode")
        return { ok: true, data: { active: shield, moderator: identity, lastActivatedAt: stamp } };
      if (command.operation === "set-shield-mode") {
        shield = command.active;
        return { ok: true, data: { active: shield, moderator: identity, lastActivatedAt: stamp } };
      }
      if (command.operation === "get-automod-settings") return { ok: true, data: policy };
      if (command.operation === "update-automod-settings") {
        policy = { ...policy, overallLevel: command.settings.overall_level ?? null };
        return { ok: true, data: policy };
      }
      if (command.operation === "get-blocked-terms")
        return { ok: true, data: { items: terms, cursor: null } };
      if (command.operation === "add-blocked-term") {
        const term = {
          id: `fixture-term-${terms.length + 1}`,
          text: command.text,
          createdAt: stamp,
          updatedAt: stamp,
          expiresAt: null,
        };
        terms = [...terms, term];
        return { ok: true, data: term };
      }
      if (command.operation === "remove-blocked-term") {
        terms = terms.filter((term) => term.id !== command.termId);
        return { ok: true, data: null };
      }
      if (command.operation === "get-chatters")
        return { ok: true, data: { items: [identity], cursor: null, total: 1, observedAt: stamp } };
      if (command.operation === "get-active-moderators")
        return {
          ok: true,
          data: {
            items: [identity],
            cursor: null,
            total: 1,
            observedAt: stamp,
            coverage: "chatters-page",
            rosterComplete: true,
          },
        };
      if (command.operation === "get-manageable-rewards")
        return {
          ok: true,
          data: { items: [{ id: "fixture-reward", title: "Read a poem", cost: 400 }] },
        };
      if (command.operation === "get-reward-redemptions")
        return {
          ok: true,
          data: {
            items: redemptions.filter((item) => item.status === "unfulfilled"),
            cursor: null,
          },
        };
      if (command.operation === "update-reward-redemption") {
        redemptions = redemptions.map((item) =>
          item.redemptionId === command.redemptionId
            ? { ...item, status: command.status === "FULFILLED" ? "fulfilled" : "canceled" }
            : item
        );
        return { ok: true, data: { items: redemptions, cursor: null } };
      }
      if (command.operation === "set-suspicious-user-status")
        return {
          ok: true,
          data: { userId: command.userId, status: command.status, updatedAt: stamp },
        };
      if (command.operation === "get-moderated-channels")
        return {
          ok: true,
          data: [
            {
              broadcaster_id: TWITCH_CHANNEL_ID,
              broadcaster_login: TWITCH_CHANNEL_LOGIN,
              broadcaster_name: twitchBroadcaster.displayName,
            },
          ],
        };
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
    eventSub: {
      start: async ({ feedId }) => {
        if (state === "reconnect-required")
          return {
            ok: false,
            error: {
              code: "missing-scope",
              message: "Reconnect Twitch with AutoMod permission in this fixture.",
            },
          };
        stateListeners.forEach((listener) => listener({ feedId, state: "connected" }));
        return { ok: true, data: null };
      },
      stop: async () => true,
      onEvent: (listener) => {
        eventListeners.add(listener);
        return () => {
          eventListeners.delete(listener);
        };
      },
      onState: (listener) => {
        stateListeners.add(listener);
        return () => {
          stateListeners.delete(listener);
        };
      },
    },
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
            ? TWITCH_APP_SCOPES.filter((scope) => scope !== "moderator:manage:automod")
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
  Object.defineProperty(channels, "getFollowed", {
    configurable: true,
    value: async () => ({ success: true, data: [] }),
  });
  Object.defineProperties(electronApi, {
    auth: { configurable: true, value: auth },
    channels: { configurable: true, value: channels },
    twitch: { configurable: true, value: createTwitchBridge(state) },
    openExternal: { configurable: true, value: async () => undefined },
    streams: {
      configurable: true,
      value: {
        ...storybookElectronApi.streams,
        getByChannel: async ({
          platform,
          username,
        }: {
          platform: "twitch" | "kick";
          username: string;
        }) => ({
          success: true,
          data: {
            id: `fixture-live-${platform}`,
            platform,
            channelId: platform === "twitch" ? TWITCH_CHANNEL_ID : KICK_CHANNEL_ID,
            channelName: username,
            channelDisplayName:
              platform === "twitch" ? twitchBroadcaster.displayName : kickBroadcaster.username,
            channelAvatar: "",
            title: "Moderation workspace fixture",
            viewerCount: 0,
            thumbnailUrl: "",
            isLive: true,
            startedAt: null,
            language: "en",
            tags: [],
          },
        }),
        getPlaybackUrl: async () => ({
          success: true,
          data: { url: "https://example.invalid/story-fixture.m3u8", format: "hls" },
        }),
        getFollowed: async () => ({ success: true, data: [], providers: { twitch: "complete" } }),
      },
    },
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

function hasRenderFunction<Key extends string>(
  component: object,
  key: Key
): component is object & Record<Key, (...args: unknown[]) => unknown> {
  return key in component && typeof Reflect.get(component, key) === "function";
}
function componentMock(component: unknown): ReturnType<typeof spyOn> {
  if (isMockFunction(component)) return component;
  if (component && typeof component === "object") {
    if ("render" in component && isMockFunction(component.render)) return component.render;
    if (hasRenderFunction(component, "render")) return spyOn(component, "render");
    if (hasRenderFunction(component, "type")) return spyOn(component, "type");
    if ("type" in component) return componentMock(component.type);
  }
  throw new Error("The workspace media fixture requires the Storybook component spy registration.");
}

function installPageFixtures(state: PageState): () => void {
  const twitchPlayerMock = componentMock(TwitchLivePlayer);
  const kickPlayerMock = componentMock(KickLivePlayer);
  const chatMock = componentMock(ChatPanel);
  const playerMocks = [twitchPlayerMock, kickPlayerMock, chatMock];
  const previousImplementations = playerMocks.map((mock) => mock.getMockImplementation());
  playerMocks.forEach((player) => player.mockClear());
  twitchPlayerMock.mockImplementation(() => (
    <div
      data-testid="mod-story-video"
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#231b35] to-[#0e0e10] text-sm text-[#adadb8]"
    >
      Twitch video fixture · local preview
    </div>
  ));
  kickPlayerMock.mockImplementation(() => (
    <div
      data-testid="mod-story-video"
      className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#172d18] to-[#0e0e10] text-sm text-[#adadb8]"
    >
      Kick video fixture · local preview
    </div>
  ));
  chatMock.mockImplementation(() => (
    <div
      data-testid="mod-story-chat"
      className="h-full space-y-3 bg-[#18181b] p-3 text-sm text-[#adadb8]"
    >
      <p>{platformFor(state) === "kick" ? "Kick" : "Twitch"} chat fixture · local preview</p>
      <p>
        <strong className="text-[#bf94ff]">Orbit Owl:</strong> Thanks for moderating today.
      </p>
      <p>
        <strong className="text-[#53fc18]">Lumen Lark:</strong> Ready for the next stream.
      </p>
    </div>
  ));
  const accountId =
    platformFor(state) === "kick"
      ? KICK_CHANNEL_ID
      : state === "twitch-moderator-ready"
        ? twitchModerator.id
        : TWITCH_CHANNEL_ID;
  const storageKey = `streamfusion:mod-layout:v1:${platformFor(state)}:${accountId}:${platformFor(state) === "kick" ? KICK_CHANNEL_ID : TWITCH_CHANNEL_ID}`;
  const previousLayout = localStorage.getItem(storageKey);
  localStorage.removeItem(storageKey);
  const restoreBridge = installPageBridge(state);
  const restoreStores = installPageStores(state);

  return () => {
    restoreStores();
    restoreBridge();
    playerMocks.forEach((player, index) => {
      player.mockReset();
      const previous = previousImplementations[index];
      if (previous) player.mockImplementation(previous);
    });
    if (previousLayout === null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, previousLayout);
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
    await expect(await canvas.findByTestId("mod-story-video")).toHaveTextContent(
      "Twitch video fixture"
    );
    await expect(await canvas.findByTestId("mod-story-chat")).toHaveTextContent(
      "Twitch chat fixture"
    );
    await expect(await canvas.findByText("No held messages.")).toBeInTheDocument();
    await expect(canvas.queryByTestId("channel-engagement-prediction")).not.toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("[data-widget-id]")).toHaveLength(4);
  },
};

export const TwitchModeratorReady: Story = {
  args: { fixtureState: "twitch-moderator-ready" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByTestId("channel-mod-log-feed")).toBeInTheDocument();
    await expect(await canvas.findByTestId("mod-story-video")).toBeInTheDocument();
    await expect(await canvas.findByTestId("mod-story-chat")).toBeInTheDocument();
    await expect(await canvas.findByText("No held messages.")).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll("[data-widget-id]")).toHaveLength(4);
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
    await expect(await canvas.findByTestId("mod-story-video")).toHaveTextContent(
      "Kick video fixture"
    );
    await expect(await canvas.findByTestId("mod-story-chat")).toHaveTextContent(
      "Kick chat fixture"
    );
    await expect(canvasElement.querySelectorAll("[data-widget-id]")).toHaveLength(4);
    await expect(canvas.queryByTestId("channel-banned-list-kick")).not.toBeInTheDocument();
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
    await expect(await canvas.findByTestId("mod-workspace")).toBeInTheDocument();
    await expect(await canvas.findByRole("button", { name: "Reconnect Twitch" })).toBeEnabled();
    await expect(canvas.queryByTestId("mod-channel-reconnect-required")).not.toBeInTheDocument();
  },
};
