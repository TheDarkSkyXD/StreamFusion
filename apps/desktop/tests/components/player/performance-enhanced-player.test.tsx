import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test-utils';

// PerformanceEnhancedPlayer reaches into the platform-specific players directly,
// not via the index re-exports — mock the direct paths.
vi.mock('@/components/player/twitch/twitch-live-player', () => ({
  TwitchLivePlayer: ({ streamUrl }: { streamUrl: string }) => (
    <div data-testid="tw-live">{streamUrl}</div>
  ),
}));

vi.mock('@/components/player/kick/kick-live-player', () => ({
  KickLivePlayer: ({ streamUrl }: { streamUrl: string }) => (
    <div data-testid="kk-live">{streamUrl}</div>
  ),
}));

import { PerformanceEnhancedPlayer } from '@/components/player/performance-enhanced-player';

describe('PerformanceEnhancedPlayer', () => {
  it('routes twitch streams to TwitchLivePlayer', () => {
    const { getByTestId } = renderWithProviders(
      <PerformanceEnhancedPlayer
        streamUrl="https://x.test/master.m3u8"
        platform="twitch"
        channelName="ninja"
      />
    );
    expect(getByTestId('tw-live')).toHaveTextContent('https://x.test/master.m3u8');
  });

  it('routes kick streams to KickLivePlayer', () => {
    const { getByTestId } = renderWithProviders(
      <PerformanceEnhancedPlayer
        streamUrl="https://x.test/kick.m3u8"
        platform="kick"
        channelName="xqc"
      />
    );
    expect(getByTestId('kk-live')).toHaveTextContent('https://x.test/kick.m3u8');
  });
});
