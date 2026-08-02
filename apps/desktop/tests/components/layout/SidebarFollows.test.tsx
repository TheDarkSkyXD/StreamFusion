import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fixtures, renderWithProviders, screen } from "../../test-utils";

const toastMock = vi.hoisted(() => vi.fn());
type TestPlatform = "twitch" | "kick";
const storeState = vi.hoisted(() => ({
  twitchConnected: true,
  kickConnected: false,
  followSyncInProgress: false,
  followSyncLastSyncedAt: {} as Partial<Record<TestPlatform, string>>,
  syncConnectedFollows: vi.fn(async () => ({
    synced: ["twitch"] as TestPlatform[],
    failed: [] as TestPlatform[],
  })),
  localFollows: [] as unknown[],
  followSources: {} as Record<string, "guest" | "twitch" | "kick" | undefined>,
  currentPipStream: null as { platform: string; channelName: string } | null,
  isPipActive: false,
}));
const routerState = vi.hoisted(() => ({
  pathname: "/",
}));

// Guards: loading state — render skeleton avatars (5 placeholders) when both followed-channels + followed-streams are still resolving, so the sidebar doesn't flash empty before data lands
// Guards: signed-out Kick cache state — cached local Kick follows render while followed-streams is still loading, so guest Kick rows are not blocked by the slower live-status scan
// Guards: signed-in Kick account state — local app-only Kick follows are hidden from the sidebar; only verified account follows may render
// Guards: platform split — Twitch and Kick followed-streams load through separate queries so Kick's slower live scan cannot block Twitch/sidebar paint
// Guards: error state — followed-streams Helix call fails: sidebar degrades to the "follow channels to see them here" empty card rather than blanking. The whole point of a sidebar is to not vanish on a transient API error
// Guards: empty state — distinct from error; "no follows + no streams" renders the empty card with the heart icon and the "Follow channels…" hint copy

// Guards: signed-in Kick startup cache state - cached account-confirmed Kick follows render before the slow Kick account/live scan resolves
// Guards: live/offline state comes from followed-stream API results, not stale localStorage status cache

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, params, search, children, className, onClick, ...rest }: any) => (
    <a
      href={typeof to === "string" ? to : "#"}
      data-to={typeof to === "string" ? to : ""}
      data-params={params ? JSON.stringify(params) : undefined}
      data-search={search ? JSON.stringify(search) : undefined}
      className={className}
      onClick={onClick}
      {...rest}
    >
      {children}
    </a>
  ),
  useLocation: () => ({ pathname: routerState.pathname }),
}));

vi.mock("@/hooks/queries/useChannels", () => ({
  useFollowedChannels: vi.fn(),
}));

vi.mock("@/hooks/queries/useStreams", () => ({
  useFollowedStreams: vi.fn(),
}));

vi.mock("@/hooks/useStreamPlayback", () => ({
  prefetchStreamPlayback: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      twitchConnected: storeState.twitchConnected,
      kickConnected: storeState.kickConnected,
      followSyncInProgress: storeState.followSyncInProgress,
      followSyncLastSyncedAt: storeState.followSyncLastSyncedAt,
      syncConnectedFollows: storeState.syncConnectedFollows,
    }),
}));

vi.mock("@/store/follow-store", () => ({
  useFollowStore: (selector: (s: unknown) => unknown) =>
    selector({
      localFollows: storeState.localFollows,
      getFollowSource: (channel: { platform: string; id?: string; username?: string }) =>
        storeState.followSources[`${channel.platform}:${channel.id ?? ""}`] ??
        (channel.username
          ? storeState.followSources[`${channel.platform}:${channel.username.toLowerCase()}`]
          : undefined) ??
        "guest",
    }),
}));

vi.mock("@/store/pip-store", () => ({
  usePipStore: (selector: (s: unknown) => unknown) =>
    selector({
      currentStream: storeState.currentPipStream,
      isPipActive: storeState.isPipActive,
    }),
}));

vi.mock("@/components/ui/platform-avatar", () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

import { SidebarFollows } from "@/components/layout/SidebarFollows";
import { useFollowedChannels } from "@/hooks/queries/useChannels";
import { useFollowedStreams } from "@/hooks/queries/useStreams";
import { prefetchStreamPlayback } from "@/hooks/useStreamPlayback";

const useFollowedChannelsMock = vi.mocked(useFollowedChannels);
const useFollowedStreamsMock = vi.mocked(useFollowedStreams);
const prefetchStreamPlaybackMock = vi.mocked(prefetchStreamPlayback);

// Guards: partnered/verified followed channels keep their platform badge in expanded sidebar rows, including live rows hydrated from followed-channel metadata
// Guards: live viewer counts and categories render on separate readable metadata rows instead of clipping at the sidebar edge
// Guards: followed rows matching the current stream route render an active state so users can see which followed channel they are watching
// Guards: selecting an offline followed channel highlights it without changing its live-first, offline-alphabetical sidebar position
// Guards: mini-player continuity - followed rows matching the active PiP stream keep the same selected state when the user navigates away from the stream page
// Guards: one Kick broadcaster renders once when guest follows and live lookups use different internal ids for the same slug
describe("SidebarFollows", () => {
  beforeEach(() => {
    useFollowedChannelsMock.mockReset();
    useFollowedStreamsMock.mockReset();
    prefetchStreamPlaybackMock.mockReset();
    storeState.twitchConnected = true;
    storeState.kickConnected = false;
    storeState.followSyncInProgress = false;
    storeState.followSyncLastSyncedAt = {};
    storeState.syncConnectedFollows.mockReset();
    storeState.syncConnectedFollows.mockResolvedValue({
      synced: ["twitch"] as TestPlatform[],
      failed: [] as TestPlatform[],
    });
    storeState.localFollows = [];
    storeState.followSources = {};
    storeState.currentPipStream = null;
    storeState.isPipActive = false;
    routerState.pathname = "/";
    window.localStorage.clear();
    toastMock.mockReset();
  });

  it("expanded: shows a compact account-follow sync button and syncs connected platforms", async () => {
    useFollowedChannelsMock.mockReturnValue({
      data: [fixtures.channel({ id: "c-1", username: "testchannel", displayName: "TestChannel" })],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    const syncButton = screen.getByRole("button", { name: /sync follows/i });
    fireEvent.click(syncButton);

    await waitFor(() => expect(storeState.syncConnectedFollows).toHaveBeenCalledOnce());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("expanded: shows pending progress and blocks duplicate sync clicks", () => {
    storeState.followSyncInProgress = true;
    useFollowedChannelsMock.mockReturnValue({
      data: [fixtures.channel({ id: "c-1", username: "testchannel", displayName: "TestChannel" })],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    const syncButton = screen.getByRole("button", { name: /sync follows/i });
    expect(syncButton).toBeDisabled();
    expect(syncButton.querySelector(".animate-spin")).toBeTruthy();
    fireEvent.click(syncButton);
    expect(storeState.syncConnectedFollows).not.toHaveBeenCalled();
  });

  it("expanded: shows the same platform-specific failure toast", async () => {
    storeState.twitchConnected = true;
    storeState.kickConnected = true;
    storeState.syncConnectedFollows.mockResolvedValue({
      synced: ["twitch"] as TestPlatform[],
      failed: ["kick"] as TestPlatform[],
    });
    useFollowedChannelsMock.mockReturnValue({
      data: [fixtures.channel({ id: "c-1", username: "testchannel", displayName: "TestChannel" })],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /sync follows/i }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        "Couldn't sync follows",
        expect.objectContaining({
          description: expect.stringContaining("Kick"),
        })
      )
    );
  });

  it("expanded: freshness title uses the oldest connected platform sync timestamp", () => {
    storeState.twitchConnected = true;
    storeState.kickConnected = true;
    storeState.followSyncLastSyncedAt = {
      twitch: "2026-07-02T18:30:00.000Z",
      kick: "2026-07-02T17:15:00.000Z",
    };
    useFollowedChannelsMock.mockReturnValue({
      data: [fixtures.channel({ id: "c-1", username: "testchannel", displayName: "TestChannel" })],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.getByRole("button", { name: /sync follows/i })).toHaveAttribute(
      "title",
      expect.stringContaining("Kick last synced")
    );
  });

  it("collapsed: keeps the sync control icon-only with a title", () => {
    useFollowedChannelsMock.mockReturnValue({
      data: [fixtures.channel({ id: "c-1", username: "testchannel", displayName: "TestChannel" })],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={true} />);

    const syncButton = screen.getByRole("button", { name: /sync follows/i });
    expect(syncButton).toHaveAttribute("title", expect.stringContaining("Sync follows"));
    expect(syncButton).toHaveClass("w-8", "h-8");
    expect(syncButton).not.toHaveTextContent(/sync|following/i);
  });

  it("loading: renders skeleton placeholders while both queries resolve", () => {
    // Both queries pending: data=undefined + isLoading=true. The component's
    // loading branch fires only when isLoading && both lists are empty.
    useFollowedChannelsMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useFollowedChannels
    >);
    useFollowedStreamsMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useFollowedStreams
    >);
    const { container } = renderWithProviders(<SidebarFollows collapsed={false} />);
    // 5 skeleton rows render with rounded-full avatar placeholders.
    const placeholders = container.querySelectorAll(".rounded-full");
    expect(placeholders.length).toBeGreaterThanOrEqual(5);
  });

  it("startup cache: renders cached Kick follows while followed streams are still loading", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "kick-cached",
        platform: "kick",
        username: "kickcached",
        displayName: "KickCached",
      }),
    ];
    useFollowedChannelsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.getAllByText("KickCached").length).toBeGreaterThan(0);
    expect(screen.queryByText(/follow channels to see them here/i)).not.toBeInTheDocument();
    expect(prefetchStreamPlaybackMock).toHaveBeenCalledWith("kick", "kickcached");
  });

  it("signed-in Kick: hides local app-only Kick follows from the sidebar", () => {
    storeState.kickConnected = true;
    storeState.localFollows = [
      fixtures.channel({
        id: "kick-local-only",
        platform: "kick",
        username: "kicklocalonly",
        displayName: "KickLocalOnly",
      }),
    ];
    useFollowedChannelsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.queryByText("KickLocalOnly")).not.toBeInTheDocument();
    expect(screen.getByText(/follow channels to see them here/i)).toBeInTheDocument();
  });

  it("signed-in Kick startup cache: renders cached account follows before Kick queries resolve", () => {
    storeState.kickConnected = true;
    storeState.localFollows = [
      fixtures.channel({
        id: "kick-account-cached",
        platform: "kick",
        username: "kickaccountcached",
        displayName: "KickAccountCached",
      }),
    ];
    storeState.followSources = {
      "kick:kick-account-cached": "kick",
    };
    useFollowedChannelsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.getAllByText("KickAccountCached").length).toBeGreaterThan(0);
    expect(screen.queryByText(/follow channels to see them here/i)).not.toBeInTheDocument();
    expect(prefetchStreamPlaybackMock).toHaveBeenCalledWith("kick", "kickaccountcached");
  });

  it("ignores stale cached live status and waits for followed-stream API truth", () => {
    const cachedLiveStream = fixtures.stream({
      id: "cached-live-stream",
      platform: "kick",
      channelId: "cached-live-channel",
      channelName: "cachedlive",
      channelDisplayName: "CachedLive",
      categoryName: "Fast Startup",
      viewerCount: 50500,
    });
    const cachedOfflineChannel = fixtures.channel({
      id: "cached-offline-channel",
      platform: "kick",
      username: "cachedoffline",
      displayName: "CachedOffline",
    });
    storeState.localFollows = [
      fixtures.channel({
        id: "cached-live-channel",
        platform: "kick",
        username: "cachedlive",
        displayName: "CachedLive",
      }),
      cachedOfflineChannel,
    ];
    window.localStorage.setItem(
      "streamfusion:sidebar-follows-cache:v2",
      JSON.stringify({
        savedAt: Date.now(),
        streams: [cachedLiveStream],
        items: [
          { type: "live", data: cachedLiveStream },
          { type: "offline", data: cachedOfflineChannel },
        ],
      })
    );
    useFollowedChannelsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.getAllByText("CachedLive").length).toBeGreaterThan(0);
    expect(screen.queryByText("50.5K")).not.toBeInTheDocument();
    expect(screen.queryByText("Fast Startup")).not.toBeInTheDocument();
    expect(screen.getAllByText("CachedOffline").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Offline").length).toBeGreaterThanOrEqual(2);
  });

  it("startup cache: keeps cached Kick follows visible when Twitch live rows fill the first slice", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "kick-cached",
        platform: "kick",
        username: "kickcached",
        displayName: "KickCached",
      }),
    ];
    const twitchChannels = Array.from({ length: 12 }, (_, i) =>
      fixtures.channel({
        id: `twitch-${i}`,
        username: `twitch${i}`,
        displayName: `Twitch ${i}`,
      })
    );
    const twitchStreams = twitchChannels.map((channel, i) =>
      fixtures.stream({
        id: `stream-${i}`,
        channelId: channel.id,
        channelName: channel.username,
        channelDisplayName: channel.displayName,
        viewerCount: 1000 - i,
      })
    );
    useFollowedChannelsMock.mockImplementation(
      (platform) =>
        ({
          data: platform === "twitch" ? twitchChannels : [],
          isLoading: false,
        }) as unknown as ReturnType<typeof useFollowedChannels>
    );
    useFollowedStreamsMock.mockReturnValue({
      data: twitchStreams,
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.getAllByText("KickCached").length).toBeGreaterThan(0);
  });

  it("platform split: queries Twitch and Kick followed streams independently", () => {
    storeState.twitchConnected = true;
    storeState.kickConnected = true;
    useFollowedChannelsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(useFollowedStreamsMock).toHaveBeenCalledWith("twitch", 100, { enabled: true });
    expect(useFollowedStreamsMock).toHaveBeenCalledWith("kick", 100, { enabled: true });
    expect(useFollowedStreamsMock).not.toHaveBeenCalledWith(
      undefined,
      expect.anything(),
      expect.anything()
    );
  });

  it("error: degrades to empty-card copy when followed-streams resolves with no data (Helix 5xx surfaces as data=undefined)", () => {
    useFollowedChannelsMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<
      typeof useFollowedChannels
    >);
    // React Query surfaces an error as { data: undefined, isLoading: false, error }
    // — the sidebar reads only data, so the error path renders the empty card.
    useFollowedStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("helix 503"),
    } as unknown as ReturnType<typeof useFollowedStreams>);
    renderWithProviders(<SidebarFollows collapsed={false} />);
    expect(screen.getByText(/follow channels to see them here/i)).toBeInTheDocument();
  });

  it("empty: renders the empty card when both lists resolve to empty arrays", () => {
    useFollowedChannelsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useFollowedChannels
    >);
    useFollowedStreamsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useFollowedStreams
    >);
    renderWithProviders(<SidebarFollows collapsed={false} />);
    expect(screen.getByText(/follow channels to see them here/i)).toBeInTheDocument();
  });

  it("empty + collapsed: keeps only the compact sync affordance when connected", () => {
    useFollowedChannelsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useFollowedChannels
    >);
    useFollowedStreamsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<
      typeof useFollowedStreams
    >);
    const { container } = renderWithProviders(<SidebarFollows collapsed={true} />);
    expect(screen.getByRole("button", { name: /sync follows/i })).toHaveClass("w-8", "h-8");
    expect(container).not.toHaveTextContent(/follow channels to see them here/i);
  });

  it("renders live channel avatars when followed-streams returns data", () => {
    useFollowedChannelsMock.mockReturnValue({
      data: [fixtures.channel({ id: "c-1", username: "testchannel", displayName: "TestChannel" })],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          channelId: "c-1",
          channelName: "testchannel",
          channelDisplayName: "TestChannel",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);
    renderWithProviders(<SidebarFollows collapsed={false} />);
    expect(screen.getAllByTestId("avatar").length).toBeGreaterThan(0);
  });

  it("renders live viewer count and category on separate readable metadata rows", () => {
    useFollowedChannelsMock.mockReturnValue({
      data: [
        fixtures.channel({
          id: "long-live-channel",
          username: "longlive",
          displayName: "LongLiveChannelName",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "long-live-stream",
          channelId: "long-live-channel",
          channelName: "longlive",
          channelDisplayName: "LongLiveChannelName",
          categoryName: "Very Long Category Name That Needs Room",
          viewerCount: 12500,
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.getByText("12.5K")).toHaveClass("tabular-nums");
    expect(screen.getByTitle("12,500 viewers")).toBeInTheDocument();
    expect(screen.getByText("Very Long Category Name That Needs Room")).toHaveClass("block");
  });

  it("marks the followed live stream matching the current route as active", () => {
    routerState.pathname = "/stream/kick/active-live";
    useFollowedChannelsMock.mockReturnValue({
      data: [
        fixtures.channel({
          id: "active-live-channel",
          platform: "kick",
          username: "active-live",
          displayName: "ActiveLive",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "active-live-stream",
          platform: "kick",
          channelId: "active-live-channel",
          channelName: "active-live",
          channelDisplayName: "ActiveLive",
          viewerCount: 12500,
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    const activeName = screen
      .getAllByText("ActiveLive")
      .find((element) => element.tagName.toLowerCase() === "span");
    const activeLink = activeName?.closest("a");
    expect(activeLink).toHaveAttribute("aria-current", "page");
    expect(activeLink).toHaveClass("bg-neutral-700/80", "border-l-[#53FC18]");
  });

  it("keeps an active offline channel in its sorted sidebar position", () => {
    routerState.pathname = "/stream/kick/jollyirl";
    storeState.kickConnected = true;
    const twitchChannels = Array.from({ length: 2 }, (_, index) =>
      fixtures.channel({
        id: `twitch-channel-${index}`,
        platform: "twitch",
        username: `twitch-live-${index}`,
        displayName: `TwitchLive${index}`,
      })
    );
    const kickChannels = [
      fixtures.channel({
        id: "kick-aardvark",
        platform: "kick",
        username: "aardvark",
        displayName: "Aardvark",
      }),
      fixtures.channel({
        id: "kick-banana",
        platform: "kick",
        username: "banana",
        displayName: "Banana",
      }),
      fixtures.channel({
        id: "kick-jolly",
        platform: "kick",
        username: "jollyirl",
        displayName: "JollyIRL",
      }),
    ];
    const twitchStreams = twitchChannels.map((channel, index) =>
      fixtures.stream({
        id: `twitch-stream-${index}`,
        platform: "twitch",
        channelId: channel.id,
        channelName: channel.username,
        channelDisplayName: channel.displayName,
        viewerCount: 10_000 - index,
      })
    );
    useFollowedChannelsMock.mockImplementation(
      (platform) =>
        ({
          data: platform === "kick" ? kickChannels : twitchChannels,
          isLoading: false,
        }) as unknown as ReturnType<typeof useFollowedChannels>
    );
    useFollowedStreamsMock.mockImplementation(
      (platform) =>
        ({
          data: platform === "twitch" ? twitchStreams : [],
          isLoading: false,
        }) as unknown as ReturnType<typeof useFollowedStreams>
    );

    renderWithProviders(<SidebarFollows collapsed={false} />);

    const activeName = screen
      .getAllByText("JollyIRL")
      .find((element) => element.tagName.toLowerCase() === "span");
    const activeLink = activeName?.closest("a");
    expect(activeLink).toHaveAttribute("aria-current", "page");
    expect(activeLink).toHaveTextContent("Offline");
    expect(activeLink).toHaveClass("bg-neutral-700/80", "border-l-[#53FC18]");

    const channelOrder = Array.from(
      screen.getByTestId("sidebar-follows").querySelectorAll<HTMLAnchorElement>("a")
    ).map((link) => JSON.parse(link.dataset.params ?? "{}").channel);
    expect(channelOrder).toEqual([
      "twitch-live-0",
      "twitch-live-1",
      "aardvark",
      "banana",
      "jollyirl",
    ]);
  });

  it("marks the followed live stream matching the active mini-player as selected off the stream route", () => {
    routerState.pathname = "/following";
    storeState.currentPipStream = { platform: "twitch", channelName: "alveussanctuary" };
    storeState.isPipActive = true;
    useFollowedChannelsMock.mockReturnValue({
      data: [
        fixtures.channel({
          id: "alveus-channel",
          username: "alveussanctuary",
          displayName: "AlveusSanctuary",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "alveus-stream",
          channelId: "alveus-channel",
          channelName: "alveussanctuary",
          channelDisplayName: "AlveusSanctuary",
          viewerCount: 2100,
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    const activeName = screen
      .getAllByText("AlveusSanctuary")
      .find((element) => element.tagName.toLowerCase() === "span");
    const activeLink = activeName?.closest("a");
    expect(activeLink).toHaveAttribute("aria-current", "true");
    expect(activeLink).toHaveClass("bg-neutral-700/80", "border-l-[#9146FF]");
  });

  it("does not mark a followed row active from stale PiP stream data when mini-player is inactive", () => {
    storeState.currentPipStream = { platform: "twitch", channelName: "alveussanctuary" };
    storeState.isPipActive = false;
    useFollowedChannelsMock.mockReturnValue({
      data: [
        fixtures.channel({
          id: "alveus-channel",
          username: "alveussanctuary",
          displayName: "AlveusSanctuary",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "alveus-stream",
          channelId: "alveus-channel",
          channelName: "alveussanctuary",
          channelDisplayName: "AlveusSanctuary",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    const rowName = screen
      .getAllByText("AlveusSanctuary")
      .find((element) => element.tagName.toLowerCase() === "span");
    const rowLink = rowName?.closest("a");
    expect(rowLink).not.toHaveAttribute("aria-current");
    expect(rowLink).not.toHaveClass("bg-neutral-700/80");
  });

  it("renders a Twitch partner badge beside an offline followed channel", () => {
    useFollowedChannelsMock.mockReturnValue({
      data: [
        fixtures.channel({
          id: "partner-offline",
          username: "partneroffline",
          displayName: "PartnerOffline",
          isPartner: true,
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.getAllByText("PartnerOffline").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Twitch verified")).toBeInTheDocument();
  });

  it("hydrates a live followed stream with channel badge metadata", () => {
    useFollowedChannelsMock.mockReturnValue({
      data: [
        fixtures.channel({
          id: "verified-live",
          platform: "kick",
          username: "verifiedlive",
          displayName: "VerifiedLive",
          isVerified: true,
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [
        fixtures.stream({
          id: "verified-live-stream",
          platform: "kick",
          channelId: "verified-live",
          channelName: "verifiedlive",
          channelDisplayName: "VerifiedLive",
        }),
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.getAllByText("VerifiedLive").length).toBeGreaterThan(0);
    expect(screen.getByAltText("Kick verified")).toBeInTheDocument();
  });

  it("prefetches visible live Kick follows without prefetching Twitch rows", () => {
    storeState.localFollows = [
      fixtures.channel({
        id: "kick-live-channel",
        platform: "kick",
        username: "kicklive",
        displayName: "KickLive",
      }),
      fixtures.channel({
        id: "twitch-live-channel",
        username: "twitchlive",
        displayName: "TwitchLive",
      }),
    ];
    useFollowedChannelsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockImplementation(
      (platform) =>
        ({
          data:
            platform === "kick"
              ? [
                  fixtures.stream({
                    id: "kick-live",
                    platform: "kick",
                    channelId: "kick-live-channel",
                    channelName: "kicklive",
                    channelDisplayName: "KickLive",
                  }),
                ]
              : [
                  fixtures.stream({
                    id: "twitch-live",
                    channelId: "twitch-live-channel",
                    channelName: "twitchlive",
                    channelDisplayName: "TwitchLive",
                  }),
                ],
          isLoading: false,
        }) as unknown as ReturnType<typeof useFollowedStreams>
    );

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(prefetchStreamPlaybackMock).toHaveBeenCalledWith("kick", "kicklive");
    expect(prefetchStreamPlaybackMock).not.toHaveBeenCalledWith("twitch", "twitchlive");
  });

  it("deduplicates a guest Kick follow and live stream by broadcaster slug", () => {
    storeState.twitchConnected = false;
    storeState.localFollows = [
      fixtures.channel({
        id: "kick-user-id",
        platform: "kick",
        username: "xqc",
        displayName: "xQc",
      }),
      fixtures.channel({
        id: "kick-channel-id",
        platform: "kick",
        username: "XQC",
        displayName: "xQc",
      }),
    ];
    useFollowedChannelsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockImplementation(
      (platform) =>
        ({
          data:
            platform === "kick"
              ? [
                  fixtures.stream({
                    id: "remote-live-id",
                    platform: "kick",
                    channelId: "kick-user-id",
                    channelName: "xqc",
                    channelDisplayName: "xQc",
                    viewerCount: 6300,
                  }),
                  fixtures.stream({
                    id: "public-live-id",
                    platform: "kick",
                    channelId: "kick-channel-id",
                    channelName: "XQC",
                    channelDisplayName: "xQc",
                    viewerCount: 6300,
                  }),
                ]
              : [],
          isLoading: false,
        }) as unknown as ReturnType<typeof useFollowedStreams>
    );

    renderWithProviders(<SidebarFollows collapsed={false} />);

    const renderedNames = screen
      .getAllByText("xQc")
      .filter((element) => element.tagName.toLowerCase() === "span");
    expect(renderedNames).toHaveLength(1);
  });
});
