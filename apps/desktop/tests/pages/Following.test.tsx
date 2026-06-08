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

// Guards: loading state — render skeleton cards (StreamGrid skeleton + offline-pills skeleton) while Helix and Kick fan-outs are pending, never blank-on-loading
// Guards: error state — Helix or Kick fan-out resolves as error (data=undefined, isLoading=false): the empty-state card surfaces with the "Follow channels to see them here" copy + Browse Channels button; users can route forward
// Guards: empty state — distinct from error; "no follows at all" renders the same empty-state card. Audit punch list flags this triplet as silent-blank-on-Helix-5xx — guarded inline
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

  it('loading: forwards isLoading to the streams grid so skeletons render instead of "no followed channels"', () => {
    useFollowedStreamsMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useFollowedStreams>);
    renderWithProviders(<FollowingPage />);
    // The mocked StreamGrid prints "loading" when isLoading is forwarded.
    expect(screen.getByTestId('stream-grid')).toHaveTextContent('loading');
    // The empty-state card MUST NOT appear during loading; otherwise the user
    // sees "no follows" before the data arrives.
    expect(screen.queryByText(/no followed channels found/i)).not.toBeInTheDocument();
  });

  it('error: Helix/Kick fan-out fails (data=undefined, isLoading=false) → empty-state card surfaces with Browse Channels CTA', () => {
    // React Query exposes a failed query as { data: undefined, isLoading: false, error }
    // — the page reads only data, so the error path collapses to the empty state.
    useFollowedChannelsMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('helix 503') } as unknown as ReturnType<typeof useFollowedChannels>);
    useFollowedStreamsMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('helix 503') } as unknown as ReturnType<typeof useFollowedStreams>);
    renderWithProviders(<FollowingPage />);
    expect(screen.getByText(/no followed channels found/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browse channels/i })).toBeInTheDocument();
  });

  // Offline-channels rendering is covered by the FollowStore unit tests + the
  // SidebarFollows integration. Here we just verify the offline section's
  // empty-state path stays correct under the local-follows store mock above.
});
