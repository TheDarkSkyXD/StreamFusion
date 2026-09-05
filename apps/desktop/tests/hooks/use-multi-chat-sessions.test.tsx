import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMultiChatChannel,
  type MultiChatChannel,
} from "@/features/chat/data/multi-chat-feed";
import { useMultiChatSessions } from "@/features/chat/data/use-multi-chat-sessions";
import { CHANNEL_KEYS } from "@/features/discovery/data/queries/useChannels";
import { fixtures, installElectronAPIMock, renderWithProviders } from "../test-utils";

const mocks = vi.hoisted(() => {
  const service = () => ({
    acquire: vi.fn(),
    release: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    joinChannel: vi.fn(async () => {}),
  });
  return {
    twitch: service(),
    kick: service(),
    unregister: new Map<string, ReturnType<typeof vi.fn>>(),
    loadGlobalEmotes: vi.fn(async () => {}),
    loadChannelEmotes: vi.fn(async () => {}),
  };
});

vi.mock("@backend/services/chat/twitch-chat", () => ({ twitchChatService: mocks.twitch }));
vi.mock("@backend/services/chat/kick-chat", () => ({ kickChatService: mocks.kick }));
vi.mock("@backend/services/emotes", () => ({
  ensureEmoteProvidersInitialized: vi.fn(),
  initializeTwitchEmotes: vi.fn(async () => {}),
  initializeKickEmotes: vi.fn(),
}));
vi.mock("@/store/emote-store", () => ({
  useEmoteStore: {
    getState: () => ({
      applyProviderPrefs: vi.fn(),
      loadGlobalEmotes: mocks.loadGlobalEmotes,
      loadChannelEmotes: mocks.loadChannelEmotes,
    }),
  },
}));
vi.mock("@/features/chat/data/chat-message-router", () => ({
  registerChatMessageRoute: ({ platform, channel }: { platform: string; channel: string }) => {
    const unregister = vi.fn();
    mocks.unregister.set(`${platform}:${channel}`, unregister);
    return unregister;
  },
}));

function deferred<T>() {
  return Promise.withResolvers<T>();
}

const platforms: ReadonlyArray<MultiChatChannel["platform"]> = ["twitch", "kick"];
const decorationCases: ReadonlyArray<{
  platform: MultiChatChannel["platform"];
  stage: "global" | "channel";
}> = [
  { platform: "twitch", stage: "global" },
  { platform: "twitch", stage: "channel" },
  { platform: "kick", stage: "global" },
  { platform: "kick", stage: "channel" },
];

function Workspace({
  channels,
  enabled = true,
}: {
  channels: MultiChatChannel[];
  enabled?: boolean;
}) {
  const state = useMultiChatSessions(channels, enabled);
  return <output>{JSON.stringify(state)}</output>;
}

let queryClient: QueryClient;

function seed(channel: MultiChatChannel) {
  queryClient.setQueryData(
    CHANNEL_KEYS.byUsername(channel.channel, channel.platform),
    fixtures.channel({
      id: channel.platform === "kick" ? "123" : channel.channel,
      platform: channel.platform,
      username: channel.channel,
      chatroomId: channel.platform === "kick" ? 456 : undefined,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.unregister.clear();
  for (const service of [mocks.twitch, mocks.kick]) {
    service.connect.mockResolvedValue(undefined);
    service.joinChannel.mockResolvedValue(undefined);
    service.release.mockResolvedValue(undefined);
  }
  mocks.loadGlobalEmotes.mockResolvedValue(undefined);
  mocks.loadChannelEmotes.mockResolvedValue(undefined);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const api = installElectronAPIMock();
  api.auth.getValidTwitchToken = vi.fn(async () => null);
  api.auth.getTwitchUser = vi.fn(async () => null);
  api.auth.getToken = vi.fn(async () => null);
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
  queryClient.clear();
});

// Guards: workspace membership changes retain existing channel ownership and routing.
// Guards: cancelled startup cannot reconnect or join after removal, and pending JOIN finishes before release.
// Guards: removed sessions cannot overwrite failures belonging to current workspace membership.
// Guards: optional global emotes cannot delay Twitch or Kick room membership.
// Guards: disposal releases acquired rooms without waiting for optional global or channel emotes.
// Guards: optional emote failures do not mark a live chat session as failed.
describe("useMultiChatSessions", () => {
  it.each(["twitch", "kick"] as const)(
    "retains %s sessions across addition, reorder, and removal",
    async (platform) => {
      const first = createMultiChatChannel(platform, "first");
      const second = createMultiChatChannel(platform, "second");
      seed(first);
      seed(second);
      const service = mocks[platform];
      const view = renderWithProviders(<Workspace channels={[first]} />, { queryClient });
      await waitFor(() => expect(service.joinChannel).toHaveBeenCalledTimes(1));
      const unregisterFirst = mocks.unregister.get(first.key);

      view.rerender(<Workspace channels={[first, second]} />);
      await waitFor(() => expect(service.joinChannel).toHaveBeenCalledTimes(2));
      expect(service.release).not.toHaveBeenCalled();
      expect(unregisterFirst).not.toHaveBeenCalled();
      expect(service.acquire.mock.calls).toEqual([["first"], ["second"]]);

      view.rerender(<Workspace channels={[second, { ...first, label: "Renamed" }]} />);
      await act(async () => {});
      expect(service.joinChannel).toHaveBeenCalledTimes(2);
      expect(service.release).not.toHaveBeenCalled();

      view.rerender(<Workspace channels={[second]} />);
      await waitFor(() => expect(service.release.mock.calls).toEqual([["first"]]));
      expect(unregisterFirst).toHaveBeenCalledOnce();
      expect(mocks.unregister.get(second.key)).not.toHaveBeenCalled();
    }
  );

  it("retains an existing session when another channel query resolves later", async () => {
    const first = createMultiChatChannel("twitch", "first");
    const second = createMultiChatChannel("twitch", "second");
    seed(first);
    const lookup =
      deferred<Awaited<ReturnType<Window["electronAPI"]["channels"]["getByUsername"]>>>();
    window.electronAPI.channels.getByUsername = vi.fn(() => lookup.promise);
    renderWithProviders(<Workspace channels={[first, second]} />, { queryClient });
    await waitFor(() => expect(mocks.twitch.joinChannel).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent('"isLoading":true');
    await act(async () => {
      lookup.resolve({
        success: true,
        data: fixtures.channel({ id: "second", username: "second" }),
      });
    });
    await waitFor(() => expect(mocks.twitch.joinChannel).toHaveBeenCalledTimes(2));
    expect(mocks.twitch.release).not.toHaveBeenCalled();
  });

  it("does not reconnect after removal while credentials are pending", async () => {
    const channel = createMultiChatChannel("twitch", "first");
    seed(channel);
    const token = deferred<string | null>();
    window.electronAPI.auth.getValidTwitchToken = vi.fn(() => token.promise);
    const view = renderWithProviders(<Workspace channels={[channel]} />, { queryClient });
    await waitFor(() => expect(window.electronAPI.auth.getValidTwitchToken).toHaveBeenCalled());
    view.rerender(<Workspace channels={[]} />);
    await act(async () => token.resolve(null));
    expect(mocks.twitch.connect).not.toHaveBeenCalled();
    expect(mocks.twitch.joinChannel).not.toHaveBeenCalled();
    expect(mocks.twitch.release).toHaveBeenCalledExactlyOnceWith("first");
  });

  it("unregisters immediately but waits for pending JOIN before releasing", async () => {
    const channel = createMultiChatChannel("twitch", "first");
    seed(channel);
    const joining = deferred<void>();
    mocks.twitch.joinChannel.mockReturnValueOnce(joining.promise);
    const view = renderWithProviders(<Workspace channels={[channel]} />, { queryClient });
    await waitFor(() => expect(mocks.twitch.joinChannel).toHaveBeenCalledOnce());
    view.rerender(<Workspace channels={[]} />);
    expect(mocks.unregister.get(channel.key)).toHaveBeenCalledOnce();
    expect(mocks.twitch.release).not.toHaveBeenCalled();
    await act(async () => joining.resolve());
    expect(mocks.twitch.release).toHaveBeenCalledExactlyOnceWith("first");
  });

  it.each(platforms)("starts %s JOIN while global emotes are still loading", async (platform) => {
    const channel = createMultiChatChannel(platform, "first");
    seed(channel);
    const globalEmotes = deferred<void>();
    mocks.loadGlobalEmotes.mockReturnValueOnce(globalEmotes.promise);
    const service = mocks[platform];
    renderWithProviders(<Workspace channels={[channel]} />, { queryClient });
    await act(async () => {});
    expect(mocks.loadGlobalEmotes).toHaveBeenCalledWith(platform);
    const joinedWhileGlobalEmotesPending = service.joinChannel.mock.calls.length === 1;
    await act(async () => globalEmotes.resolve());
    expect(service.joinChannel).toHaveBeenCalledOnce();
    expect(joinedWhileGlobalEmotesPending).toBe(true);
  });

  it.each(decorationCases)(
    "releases $platform promptly while $stage emotes are still loading",
    async ({ platform, stage }) => {
      const channel = createMultiChatChannel(platform, "first");
      seed(channel);
      const decoration = deferred<void>();
      const loadEmotes = stage === "global" ? mocks.loadGlobalEmotes : mocks.loadChannelEmotes;
      loadEmotes.mockReturnValueOnce(decoration.promise);
      const service = mocks[platform];
      const view = renderWithProviders(<Workspace channels={[channel]} />, { queryClient });
      await act(async () => {});
      expect(loadEmotes).toHaveBeenCalledOnce();
      view.rerender(<Workspace channels={[]} />);
      await act(async () => {});
      const releasedWhileDecorationPending = service.release.mock.calls.length === 1;
      await act(async () => decoration.resolve());
      expect(service.release).toHaveBeenCalledExactlyOnceWith("first");
      expect(releasedWhileDecorationPending).toBe(true);
    }
  );

  it.each(decorationCases)(
    "does not mark $platform failed when $stage emotes reject",
    async ({ platform, stage }) => {
      const channel = createMultiChatChannel(platform, "first");
      seed(channel);
      const loadEmotes = stage === "global" ? mocks.loadGlobalEmotes : mocks.loadChannelEmotes;
      loadEmotes.mockRejectedValueOnce(new Error(`${stage} emotes unavailable`));
      renderWithProviders(<Workspace channels={[channel]} />, { queryClient });
      await act(async () => {});
      expect(loadEmotes).toHaveBeenCalledOnce();
      await act(async () => {});
      expect(screen.getByRole("status")).toHaveTextContent('"failedChannels":[]');
    }
  );

  it("waits for pending JOIN even when channel decorations fail first", async () => {
    const channel = createMultiChatChannel("twitch", "first");
    seed(channel);
    const joining = deferred<void>();
    mocks.twitch.joinChannel.mockReturnValueOnce(joining.promise);
    mocks.loadChannelEmotes.mockRejectedValueOnce(new Error("emotes unavailable"));
    const view = renderWithProviders(<Workspace channels={[channel]} />, { queryClient });
    await waitFor(() => expect(mocks.loadChannelEmotes).toHaveBeenCalledOnce());
    view.rerender(<Workspace channels={[]} />);
    await act(async () => {});
    expect(mocks.twitch.release).not.toHaveBeenCalled();
    await act(async () => joining.resolve());
    expect(mocks.twitch.release).toHaveBeenCalledExactlyOnceWith("first");
  });

  it("waits for an old channel release before rejoining that channel", async () => {
    const channel = createMultiChatChannel("twitch", "first");
    seed(channel);
    const release = deferred<void>();
    mocks.twitch.release.mockReturnValueOnce(release.promise);
    const view = renderWithProviders(<Workspace channels={[channel]} />, { queryClient });
    await waitFor(() => expect(mocks.twitch.joinChannel).toHaveBeenCalledOnce());
    view.rerender(<Workspace channels={[]} />);
    await waitFor(() => expect(mocks.twitch.release).toHaveBeenCalledOnce());
    view.rerender(<Workspace channels={[channel]} />);
    await act(async () => {});
    expect(mocks.twitch.joinChannel).toHaveBeenCalledOnce();
    await act(async () => release.resolve());
    expect(mocks.twitch.joinChannel).toHaveBeenCalledTimes(2);
  });

  it.each(["twitch", "kick"] as const)(
    "does not join %s after removal during connection",
    async (platform) => {
      const channel = createMultiChatChannel(platform, "first");
      seed(channel);
      const connection = deferred<void>();
      const service = mocks[platform];
      service.connect.mockReturnValueOnce(connection.promise);
      const view = renderWithProviders(<Workspace channels={[channel]} />, { queryClient });
      await waitFor(() => expect(service.connect).toHaveBeenCalledOnce());
      view.rerender(<Workspace channels={[]} />);
      await act(async () => connection.resolve());
      expect(service.joinChannel).not.toHaveBeenCalled();
      expect(service.release).toHaveBeenCalledExactlyOnceWith("first");
    }
  );

  it("releases each acquired session once across StrictMode, disabling, and unmount", async () => {
    const channel = createMultiChatChannel("twitch", "first");
    seed(channel);
    const workspace = (enabled: boolean) => (
      <StrictMode>
        <Workspace channels={[channel]} enabled={enabled} />
      </StrictMode>
    );
    const view = renderWithProviders(workspace(true), { queryClient });
    await waitFor(() => expect(mocks.twitch.joinChannel).toHaveBeenCalledOnce());
    view.rerender(workspace(false));
    await waitFor(() => expect(mocks.twitch.release).toHaveBeenCalledOnce());
    view.rerender(workspace(true));
    await waitFor(() => expect(mocks.twitch.joinChannel).toHaveBeenCalledTimes(2));
    view.unmount();
    await act(async () => {});
    expect(mocks.twitch.acquire.mock.calls).toEqual([["first"], ["first"]]);
    expect(mocks.twitch.release.mock.calls).toEqual([["first"], ["first"]]);
  });

  it("keeps current failures while ignoring removed startup failures", async () => {
    const first = createMultiChatChannel("twitch", "first");
    const second = createMultiChatChannel("kick", "second");
    seed(first);
    seed(second);
    mocks.twitch.joinChannel.mockRejectedValueOnce(new Error("join rejected"));
    const joining = deferred<void>();
    mocks.kick.joinChannel.mockReturnValueOnce(joining.promise);
    const view = renderWithProviders(<Workspace channels={[first, second]} />, { queryClient });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(first.key));
    view.rerender(<Workspace channels={[first]} />);
    await act(async () => joining.reject(new Error("removed channel failed")));
    expect(screen.getByRole("status")).toHaveTextContent(first.key);
    expect(screen.getByRole("status")).not.toHaveTextContent(second.key);
  });
});
