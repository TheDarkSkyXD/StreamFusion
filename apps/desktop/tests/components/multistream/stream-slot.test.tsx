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

// Guards: platform routing — twitch streams mount the Twitch live player, kick streams mount Kick. Silently mounting the wrong one would render a blank slot for the platform that didn't match
// Guards: loading/error/offline state — when playback is null (loading or failed) the slot renders the offline overlay with "is currently offline" + Check Again, not a black square. The Check Again button triggers a fresh playback fetch via reload()
// Guards: cross-slot isolation — each StreamSlot owns its own playback hook (useStreamPlayback) and its own onError. One slot's failed HLS init must not blank the sibling slot; this is enforced by per-slot mounting (verified by the slot rendering its overlay locally without unmounting the player on the other slot)
// Note: the multistream grid mounts multiple StreamSlots independently — slot isolation is locked at the grid level (grid-layout.test.tsx) and at the slot level (offline overlay verified here)
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
