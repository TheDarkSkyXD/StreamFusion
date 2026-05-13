import { describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/store/multistream-store', () => ({
  useMultiStreamStore: () => ({
    toggleMute: vi.fn(),
    setChatStream: vi.fn(),
    chatStreamId: null,
  }),
}));

vi.mock('@/hooks/queries/useChannels', () => ({
  useChannelByUsername: () => ({ data: fixtures.channel({ displayName: 'Ninja' }) }),
}));

vi.mock('@/hooks/useStreamPlayback', () => ({
  useStreamPlayback: () => ({
    playback: { url: 'https://x.test/playlist.m3u8' },
    isLoading: false,
    reload: vi.fn(),
  }),
}));

vi.mock('@/components/player/twitch', () => ({
  TwitchLivePlayer: () => <div data-testid="tw-live-player">player</div>,
}));

vi.mock('@/components/player/kick', () => ({
  KickLivePlayer: () => <div data-testid="kick-live-player">player</div>,
}));

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { StreamSlot } from '@/components/multistream/stream-slot';

describe('StreamSlot', () => {
  it('renders the Twitch live player for twitch streams', () => {
    renderWithProviders(
      <StreamSlot
        streamId="s1"
        platform="twitch"
        channelName="ninja"
        isMuted={false}
        onRemove={vi.fn()}
        onFocus={vi.fn()}
        isFocused={false}
      />
    );
    expect(screen.getByTestId('tw-live-player')).toBeInTheDocument();
  });

  it('renders the Kick live player for kick streams', () => {
    renderWithProviders(
      <StreamSlot
        streamId="s1"
        platform="kick"
        channelName="xqc"
        isMuted={false}
        onRemove={vi.fn()}
        onFocus={vi.fn()}
        isFocused={false}
      />
    );
    expect(screen.getByTestId('kick-live-player')).toBeInTheDocument();
  });
});
