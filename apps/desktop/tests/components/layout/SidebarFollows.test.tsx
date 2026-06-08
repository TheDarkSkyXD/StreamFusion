import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../../test-utils';

// Guards: loading state — render skeleton avatars (5 placeholders) when both followed-channels + followed-streams are still resolving, so the sidebar doesn't flash empty before data lands
// Guards: error state — followed-streams Helix call fails: sidebar degrades to the "follow channels to see them here" empty card rather than blanking. The whole point of a sidebar is to not vanish on a transient API error
// Guards: empty state — distinct from error; "no follows + no streams" renders the empty card with the heart icon and the "Follow channels…" hint copy

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/hooks/queries/useChannels', () => ({
  useFollowedChannels: vi.fn(),
}));

vi.mock('@/hooks/queries/useStreams', () => ({
  useFollowedStreams: vi.fn(),
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ twitchConnected: true, kickConnected: false }),
}));

vi.mock('@/store/follow-store', () => ({
  useFollowStore: (selector: (s: unknown) => unknown) => selector({ localFollows: [] }),
}));

vi.mock('@/components/ui/platform-avatar', () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

import { useFollowedChannels } from '@/hooks/queries/useChannels';
import { useFollowedStreams } from '@/hooks/queries/useStreams';
import { SidebarFollows } from '@/components/layout/SidebarFollows';

const useFollowedChannelsMock = vi.mocked(useFollowedChannels);
const useFollowedStreamsMock = vi.mocked(useFollowedStreams);

describe('SidebarFollows', () => {
  beforeEach(() => {
    useFollowedChannelsMock.mockReset();
    useFollowedStreamsMock.mockReset();
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
});
