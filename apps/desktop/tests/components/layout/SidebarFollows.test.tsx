import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../../test-utils';

const storeState = vi.hoisted(() => ({
  twitchConnected: true,
  kickConnected: false,
  localFollows: [] as unknown[],
  followSources: {} as Record<string, 'guest' | 'twitch' | 'kick' | undefined>,
}));

// Guards: loading state — render skeleton avatars (5 placeholders) when both followed-channels + followed-streams are still resolving, so the sidebar doesn't flash empty before data lands
// Guards: signed-out Kick cache state — cached local Kick follows render while followed-streams is still loading, so guest Kick rows are not blocked by the slower live-status scan
// Guards: signed-in Kick account state — local app-only Kick follows are hidden from the sidebar; only verified account follows may render
// Guards: platform split — Twitch and Kick followed-streams load through separate queries so Kick's slower live scan cannot block Twitch/sidebar paint
// Guards: error state — followed-streams Helix call fails: sidebar degrades to the "follow channels to see them here" empty card rather than blanking. The whole point of a sidebar is to not vanish on a transient API error
// Guards: empty state — distinct from error; "no follows + no streams" renders the empty card with the heart icon and the "Follow channels…" hint copy

// Guards: signed-in Kick startup cache state - cached account-confirmed Kick follows render before the slow Kick account/live scan resolves

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/hooks/queries/useChannels', () => ({
  useFollowedChannels: vi.fn(),
}));

vi.mock('@/hooks/queries/useStreams', () => ({
  useFollowedStreams: vi.fn(),
}));

vi.mock('@/hooks/useStreamPlayback', () => ({
  prefetchStreamPlayback: vi.fn(),
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({
      twitchConnected: storeState.twitchConnected,
      kickConnected: storeState.kickConnected,
    }),
}));

vi.mock('@/store/follow-store', () => ({
  useFollowStore: (selector: (s: unknown) => unknown) =>
    selector({
      localFollows: storeState.localFollows,
      getFollowSource: (channel: { platform: string; id?: string; username?: string }) =>
        storeState.followSources[`${channel.platform}:${channel.id ?? ''}`] ??
        (channel.username
          ? storeState.followSources[`${channel.platform}:${channel.username.toLowerCase()}`]
          : undefined) ??
        'guest',
    }),
}));

vi.mock('@/components/ui/platform-avatar', () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

import { useFollowedChannels } from '@/hooks/queries/useChannels';
import { useFollowedStreams } from '@/hooks/queries/useStreams';
import { prefetchStreamPlayback } from '@/hooks/useStreamPlayback';
import { SidebarFollows } from '@/components/layout/SidebarFollows';

const useFollowedChannelsMock = vi.mocked(useFollowedChannels);
const useFollowedStreamsMock = vi.mocked(useFollowedStreams);
const prefetchStreamPlaybackMock = vi.mocked(prefetchStreamPlayback);

describe('SidebarFollows', () => {
  beforeEach(() => {
    useFollowedChannelsMock.mockReset();
    useFollowedStreamsMock.mockReset();
    prefetchStreamPlaybackMock.mockReset();
    storeState.twitchConnected = true;
    storeState.kickConnected = false;
    storeState.localFollows = [];
    storeState.followSources = {};
  });

  it('loading: renders skeleton placeholders while both queries resolve', () => {
    // Both queries pending: data=undefined + isLoading=true. The component's
    // loading branch fires only when isLoading && both lists are empty.
    useFollowedChannelsMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useFollowedStreams>);
    const { container } = renderWithProviders(<SidebarFollows collapsed={false} />);
    // 5 skeleton rows render with rounded-full avatar placeholders.
    const placeholders = container.querySelectorAll('.rounded-full');
    expect(placeholders.length).toBeGreaterThanOrEqual(5);
  });

  it('startup cache: renders cached Kick follows while followed streams are still loading', () => {
    storeState.localFollows = [
      fixtures.channel({
        id: 'kick-cached',
        platform: 'kick',
        username: 'kickcached',
        displayName: 'KickCached',
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

    expect(screen.getAllByText('KickCached').length).toBeGreaterThan(0);
    expect(screen.queryByText(/follow channels to see them here/i)).not.toBeInTheDocument();
    expect(prefetchStreamPlaybackMock).toHaveBeenCalledWith('kick', 'kickcached');
  });

  it('signed-in Kick: hides local app-only Kick follows from the sidebar', () => {
    storeState.kickConnected = true;
    storeState.localFollows = [
      fixtures.channel({
        id: 'kick-local-only',
        platform: 'kick',
        username: 'kicklocalonly',
        displayName: 'KickLocalOnly',
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

    expect(screen.queryByText('KickLocalOnly')).not.toBeInTheDocument();
    expect(screen.getByText(/follow channels to see them here/i)).toBeInTheDocument();
  });

  it('signed-in Kick startup cache: renders cached account follows before Kick queries resolve', () => {
    storeState.kickConnected = true;
    storeState.localFollows = [
      fixtures.channel({
        id: 'kick-account-cached',
        platform: 'kick',
        username: 'kickaccountcached',
        displayName: 'KickAccountCached',
      }),
    ];
    storeState.followSources = {
      'kick:kick-account-cached': 'kick',
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

    expect(screen.getAllByText('KickAccountCached').length).toBeGreaterThan(0);
    expect(screen.queryByText(/follow channels to see them here/i)).not.toBeInTheDocument();
    expect(prefetchStreamPlaybackMock).toHaveBeenCalledWith('kick', 'kickaccountcached');
  });

  it('startup cache: keeps cached Kick follows visible when Twitch live rows fill the first slice', () => {
    storeState.localFollows = [
      fixtures.channel({
        id: 'kick-cached',
        platform: 'kick',
        username: 'kickcached',
        displayName: 'KickCached',
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
    useFollowedChannelsMock.mockImplementation((platform) =>
      ({
        data: platform === 'twitch' ? twitchChannels : [],
        isLoading: false,
      }) as unknown as ReturnType<typeof useFollowedChannels>
    );
    useFollowedStreamsMock.mockReturnValue({
      data: twitchStreams,
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(screen.getAllByText('KickCached').length).toBeGreaterThan(0);
  });

  it('platform split: queries Twitch and Kick followed streams independently', () => {
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

    expect(useFollowedStreamsMock).toHaveBeenCalledWith('twitch', 100, { enabled: true });
    expect(useFollowedStreamsMock).toHaveBeenCalledWith('kick', 100, { enabled: true });
    expect(useFollowedStreamsMock).not.toHaveBeenCalledWith(
      undefined,
      expect.anything(),
      expect.anything()
    );
  });

  it('error: degrades to empty-card copy when followed-streams resolves with no data (Helix 5xx surfaces as data=undefined)', () => {
    useFollowedChannelsMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<typeof useFollowedChannels>);
    // React Query surfaces an error as { data: undefined, isLoading: false, error }
    // — the sidebar reads only data, so the error path renders the empty card.
    useFollowedStreamsMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('helix 503') } as unknown as ReturnType<typeof useFollowedStreams>);
    renderWithProviders(<SidebarFollows collapsed={false} />);
    expect(screen.getByText(/follow channels to see them here/i)).toBeInTheDocument();
  });

  it('empty: renders the empty card when both lists resolve to empty arrays', () => {
    useFollowedChannelsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useFollowedStreams>);
    renderWithProviders(<SidebarFollows collapsed={false} />);
    expect(screen.getByText(/follow channels to see them here/i)).toBeInTheDocument();
  });

  it('empty + collapsed: returns null so the collapsed rail doesn\'t reserve a hint area', () => {
    useFollowedChannelsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useFollowedStreams>);
    const { container } = renderWithProviders(<SidebarFollows collapsed={true} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders live channel avatars when followed-streams returns data', () => {
    useFollowedChannelsMock.mockReturnValue({
      data: [fixtures.channel({ id: 'c-1', username: 'testchannel', displayName: 'TestChannel' })],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({
      data: [fixtures.stream({ channelId: 'c-1', channelName: 'testchannel', channelDisplayName: 'TestChannel' })],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedStreams>);
    renderWithProviders(<SidebarFollows collapsed={false} />);
    expect(screen.getAllByTestId('avatar').length).toBeGreaterThan(0);
  });

  it('prefetches visible live Kick follows without prefetching Twitch rows', () => {
    storeState.localFollows = [
      fixtures.channel({
        id: 'kick-live-channel',
        platform: 'kick',
        username: 'kicklive',
        displayName: 'KickLive',
      }),
      fixtures.channel({
        id: 'twitch-live-channel',
        username: 'twitchlive',
        displayName: 'TwitchLive',
      }),
    ];
    useFollowedChannelsMock.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockImplementation((platform) =>
      ({
        data:
          platform === 'kick'
            ? [
                fixtures.stream({
                  id: 'kick-live',
                  platform: 'kick',
                  channelId: 'kick-live-channel',
                  channelName: 'kicklive',
                  channelDisplayName: 'KickLive',
                }),
              ]
            : [
                fixtures.stream({
                  id: 'twitch-live',
                  channelId: 'twitch-live-channel',
                  channelName: 'twitchlive',
                  channelDisplayName: 'TwitchLive',
                }),
              ],
        isLoading: false,
      }) as unknown as ReturnType<typeof useFollowedStreams>
    );

    renderWithProviders(<SidebarFollows collapsed={false} />);

    expect(prefetchStreamPlaybackMock).toHaveBeenCalledWith('kick', 'kicklive');
    expect(prefetchStreamPlaybackMock).not.toHaveBeenCalledWith('twitch', 'twitchlive');
  });
});
