import { describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/ui/platform-avatar', () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

vi.mock('@/components/ui/follow-button', () => ({
  FollowButton: () => <button type="button">Follow</button>,
}));

import { StreamInfo } from '@/components/stream/stream-info';

describe('StreamInfo', () => {
  it('renders skeletons while loading', () => {
    const { container } = renderWithProviders(
      <StreamInfo channel={null} stream={null} isLoading={true} />
    );
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders channel displayName and avatar', () => {
    renderWithProviders(
      <StreamInfo
        channel={fixtures.channel({ displayName: 'NinjaX', isVerified: true })}
        stream={fixtures.stream({ isLive: true, title: 'Going live' })}
        isLoading={false}
      />
    );
    expect(screen.getByRole('heading', { name: /ninjax/i })).toBeInTheDocument();
    expect(screen.getByTestId('avatar')).toHaveTextContent('NinjaX');
  });
});
