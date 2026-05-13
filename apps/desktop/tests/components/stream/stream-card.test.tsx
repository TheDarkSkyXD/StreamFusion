import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtures, installElectronAPIMock, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div data-testid="thumb">{alt}</div>,
}));

vi.mock('@/components/ui/platform-avatar', () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

import { StreamCard } from '@/components/stream/stream-card';

describe('StreamCard', () => {
  beforeEach(() => {
    installElectronAPIMock();
  });

  it('renders the stream title and channel display name', () => {
    renderWithProviders(<StreamCard stream={fixtures.stream({ title: 'My title', channelDisplayName: 'NinjaX' })} />);
    expect(screen.getByTestId('thumb')).toHaveTextContent('My title');
    // displayName shows in multiple spots (avatar + label) — at least one is enough.
    expect(screen.getAllByText('NinjaX').length).toBeGreaterThan(0);
  });

  it('renders a live badge for live streams', () => {
    renderWithProviders(<StreamCard stream={fixtures.stream({ isLive: true })} />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('renders viewer count', () => {
    renderWithProviders(<StreamCard stream={fixtures.stream({ viewerCount: 1234 })} />);
    expect(screen.getByText(/1\.2K/i)).toBeInTheDocument();
  });
});
