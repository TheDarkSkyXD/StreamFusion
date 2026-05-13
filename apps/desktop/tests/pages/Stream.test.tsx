import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/hooks/useStreamPlayback', () => ({
  useStreamPlayback: () => ({
    playback: null,
    isLoading: false,
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

const useChannelMock = vi.mocked(useChannelByUsername);
const useStreamMock = vi.mocked(useStreamByChannel);

describe('StreamPage', () => {
  beforeEach(() => {
    useChannelMock.mockReset();
    useStreamMock.mockReset();
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
});
