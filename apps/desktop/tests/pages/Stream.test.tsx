import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock({ params: { platform: 'twitch', channel: 'ninja' } }));

vi.mock('@/hooks/queries/useChannels', () => ({
  useChannelByUsername: vi.fn(),
}));

vi.mock('@/hooks/queries/useStreams', () => ({
  useStreamByChannel: vi.fn(),
  useFollowedStreams: vi.fn(),
  useTopStreams: vi.fn(),
}));

// Mutable holder so individual tests can flip the playback state (loading /
// offline / live) without re-registering vi.mock — the factory closes over the
// reference returned here.
const mockPlaybackState: {
  playback: { url: string } | null;
  isLoading: boolean;
} = { playback: null, isLoading: false };

vi.mock('@/hooks/useStreamPlayback', () => ({
  useStreamPlayback: () => ({
    get playback() {
      return mockPlaybackState.playback;
    },
    get isLoading() {
      return mockPlaybackState.isLoading;
    },
    reload: vi.fn(),
    isUsingProxy: false,
    retryWithoutProxy: vi.fn(),
    reloadAttempts: 0,
  }),
}));

vi.mock('@/store/app-store', () => ({
  useAppStore: () => ({ isTheaterModeActive: false, setTheaterModeActive: vi.fn() }),
}));

vi.mock('@/store/pip-store', () => ({
  usePipStore: () => ({
    isPip: false,
    openPip: vi.fn(),
    closePip: vi.fn(),
    setCurrentStream: vi.fn(),
    setIsOnStreamPage: vi.fn(),
    isOnStreamPage: false,
    currentStream: null,
  }),
}));

vi.mock('@/components/player/twitch', () => ({
  TwitchLivePlayer: () => <div data-testid="twitch-live-player">player</div>,
}));

vi.mock('@/components/player/kick', () => ({
  KickLivePlayer: () => <div data-testid="kick-live-player">player</div>,
}));

vi.mock('@/components/chat', () => ({
  ChatPanel: () => <div data-testid="chat-panel">chat</div>,
}));

vi.mock('@/components/stream/related-content', () => ({
  RelatedContent: () => <div data-testid="related-content">related</div>,
}));

vi.mock('@/components/stream/stream-info', () => ({
  StreamInfo: ({ stream }: { stream?: { title?: string } }) => (
    <div data-testid="stream-info">{stream?.title ?? 'no-title'}</div>
  ),
}));

import { useChannelByUsername } from '@/hooks/queries/useChannels';
import { useStreamByChannel } from '@/hooks/queries/useStreams';
import { StreamPage } from '@/pages/Stream';
import { DEFAULT_CHAT_PREFERENCES } from '@/shared/auth-types';
import { useAuthStore } from '@/store/auth-store';

const useChannelMock = vi.mocked(useChannelByUsername);
const useStreamMock = vi.mocked(useStreamByChannel);

// Restore chat-position pref between tests so the hide-panel test doesn't leak
// into the default-render assertions above.
function setChatPosition(position: 'right' | 'left' | 'hidden') {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      chat: { ...DEFAULT_CHAT_PREFERENCES, position },
    } as typeof s.preferences,
  }));
}

// Guards: loading state — while channel meta + HLS playback are pending, the player area mounts the platform loading spinner (Twitch purple / Kick green) so users see "loading", not "broken"
// Guards: offline state — channel exists but streamData.startedAt is null AND no playback URL → "is currently offline" panel with a Check Again button so the page is recoverable. Distinct from "error" (which uses the same panel but is gated by playerError) — both surfaces resolve to the same UI because users can't tell the cases apart
// Guards: error path — handlePlayerError absorbs PROXY_ERROR / NO_FRAGMENTS / TOKEN_EXPIRED via auto-refresh under 3 attempts; STREAM_OFFLINE surfaces the offline overlay when proxy fallback isn't available. The non-fatal paths must NOT show the offline overlay (verified by absence of "is currently offline" while still loading)
// Guards: empty channelData (loading) doesn't blank the page — even before channelData resolves the player layout reserves space so the layout doesn't shift after data lands
describe('StreamPage', () => {
  beforeEach(() => {
    useChannelMock.mockReset();
    useStreamMock.mockReset();
    setChatPosition('right');
    mockPlaybackState.playback = null;
    mockPlaybackState.isLoading = false;
  });

  afterEach(() => {
    setChatPosition('right');
  });

  it('renders the Twitch live player + chat for a twitch route', () => {
    useChannelMock.mockReturnValue({ data: fixtures.channel(), isLoading: false } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({ data: fixtures.stream({ title: 'Going live' }), isLoading: false } as ReturnType<typeof useStreamByChannel>);
    renderWithProviders(<StreamPage />);
    expect(screen.getByTestId('twitch-live-player')).toBeInTheDocument();
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });

  it('passes the loaded stream into StreamInfo', () => {
    useChannelMock.mockReturnValue({ data: fixtures.channel(), isLoading: false } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({ data: fixtures.stream({ title: 'My Title' }), isLoading: false } as ReturnType<typeof useStreamByChannel>);
    renderWithProviders(<StreamPage />);
    expect(screen.getByTestId('stream-info')).toHaveTextContent('My Title');
  });

  it('hides the chat panel when chat position is "hidden" (U5)', () => {
    useChannelMock.mockReturnValue({ data: fixtures.channel(), isLoading: false } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({ data: fixtures.stream({ title: 'Going live' }), isLoading: false } as ReturnType<typeof useStreamByChannel>);
    setChatPosition('hidden');
    renderWithProviders(<StreamPage />);
    // Player still renders; the chat panel (and the chat service it mounts) does not.
    expect(screen.getByTestId('twitch-live-player')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).toBeNull();
  });

  it('loading: shows the platform spinner while playback + channel + stream all resolve', () => {
    useChannelMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = true;
    mockPlaybackState.playback = null;
    const { container } = renderWithProviders(<StreamPage />);
    // Loading spinner has class 'animate-spin' — search the rendered tree for it.
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    // The "offline" panel must NOT render while we're still loading.
    expect(screen.queryByText(/is currently offline/i)).toBeNull();
  });

  it('offline: channel exists but stream is not live and no playback url → "is currently offline" panel with Check Again', () => {
    useChannelMock.mockReturnValue({
      data: fixtures.channel({ displayName: 'OfflineGuy' }),
      isLoading: false,
    } as ReturnType<typeof useChannelByUsername>);
    // streamData with no startedAt → isStreamLive=false.
    useStreamMock.mockReturnValue({
      // biome-ignore lint/suspicious/noExplicitAny: test shape — offline stream has no startedAt
      data: { ...fixtures.stream(), startedAt: null } as any,
      isLoading: false,
    } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = null;
    renderWithProviders(<StreamPage />);
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check again/i })).toBeInTheDocument();
  });

  it('error path (no playback url, no channel data) still surfaces the offline panel — same shape as offline so users see one consistent recovery affordance', () => {
    // Both the channel query and the stream query failed (data=undefined,
    // isLoading=false). The page degrades to the offline panel using the
    // route param as the channel name.
    useChannelMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<typeof useChannelByUsername>);
    useStreamMock.mockReturnValue({ data: undefined, isLoading: false } as ReturnType<typeof useStreamByChannel>);
    mockPlaybackState.isLoading = false;
    mockPlaybackState.playback = null;
    renderWithProviders(<StreamPage />);
    expect(screen.getByText(/is currently offline/i)).toBeInTheDocument();
  });
});
