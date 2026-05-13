import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, fixtures, renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/hooks/queries/useChannels', () => ({
  useFollowedChannels: vi.fn(),
  useChannelByUsername: vi.fn(),
}));

vi.mock('@/hooks/queries/useStreams', () => ({
  useFollowedStreams: vi.fn(),
  useTopStreams: vi.fn(),
  useStreamByChannel: vi.fn(),
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: () => ({ twitchConnected: false, kickConnected: false }),
}));

vi.mock('@/store/follow-store', () => ({
  useFollowStore: () => ({ localFollows: [] }),
}));

vi.mock('@/components/stream/stream-grid', () => ({
  StreamGrid: ({ streams, isLoading }: { streams?: { title: string }[]; isLoading?: boolean }) => (
    <div data-testid="stream-grid">
      {isLoading ? 'loading' : `${streams?.length ?? 0} streams`}
    </div>
  ),
}));

vi.mock('@/components/ui/platform-avatar', () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

import { useFollowedChannels } from '@/hooks/queries/useChannels';
import { useFollowedStreams } from '@/hooks/queries/useStreams';
import { FollowingPage } from '@/pages/Following';

const useFollowedChannelsMock = vi.mocked(useFollowedChannels);
const useFollowedStreamsMock = vi.mocked(useFollowedStreams);

describe('FollowingPage', () => {
  beforeEach(() => {
    useFollowedChannelsMock.mockReset();
    useFollowedStreamsMock.mockReset();
    useFollowedChannelsMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<typeof useFollowedStreams>);
  });

  it('renders the page heading and platform filter buttons', () => {
    renderWithProviders(<FollowingPage />);
    expect(screen.getByRole('heading', { name: /following/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /twitch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /kick/i })).toBeInTheDocument();
  });

  it('shows empty-state when there are no follows', () => {
    renderWithProviders(<FollowingPage />);
    expect(screen.getByText(/no followed channels found/i)).toBeInTheDocument();
    expect(screen.getByText(/follow channels to see them here/i)).toBeInTheDocument();
  });

  it('shows search-specific empty message when filter has no hits', () => {
    renderWithProviders(<FollowingPage />);
    fireEvent.change(screen.getByPlaceholderText(/search followed channels/i), {
      target: { value: 'no-such-channel' },
    });
    expect(screen.getByText(/no matches for "no-such-channel"/i)).toBeInTheDocument();
  });

  // Offline-channels rendering is covered by the FollowStore unit tests + the
  // SidebarFollows integration. Here we just verify the offline section's
  // empty-state path stays correct under the local-follows store mock above.
});
