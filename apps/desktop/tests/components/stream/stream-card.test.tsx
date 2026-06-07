import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlatformHealth } from '@/backend/api/unified/platform-health';
import { fixtures, installElectronAPIMock, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div data-testid="thumb">{alt}</div>,
}));

vi.mock('@/components/ui/platform-avatar', () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div data-testid="avatar">{alt}</div>,
}));

interface PlatformHealthState {
  kick: PlatformHealth;
  twitch: PlatformHealth;
  anyDegraded: boolean;
}

const healthyState: PlatformHealthState = { kick: 'healthy', twitch: 'healthy', anyDegraded: false };

let mockHealthState: PlatformHealthState = healthyState;

vi.mock('@/hooks/usePlatformHealth', () => ({
  usePlatformHealth: () => mockHealthState,
}));

import { StreamCard } from '@/components/stream/stream-card';

describe('StreamCard', () => {
  beforeEach(() => {
    installElectronAPIMock();
    mockHealthState = healthyState;
  });

  it('renders the stream title and channel display name', () => {
    renderWithProviders(<StreamCard stream={fixtures.stream({ title: 'My title', channelDisplayName: 'NinjaX' })} />);
    expect(screen.getByTestId('thumb')).toHaveTextContent('My title');
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

  describe('staleness overlay', () => {
    it('does not apply staleness styles when platform is healthy', () => {
      const { container } = renderWithProviders(
        <StreamCard stream={fixtures.stream({ platform: 'kick' })} />
      );
      const card = container.querySelector('[data-testid="stream-card"]')!;
      expect(card).not.toHaveClass('opacity-75');
      expect(screen.queryByTestId('staleness-badge')).toBeNull();
    });

    it('applies reduced opacity when platform is degraded', () => {
      mockHealthState = { kick: 'degraded', twitch: 'healthy', anyDegraded: true };
      const { container } = renderWithProviders(
        <StreamCard stream={fixtures.stream({ platform: 'kick' })} />
      );
      const card = container.querySelector('[data-testid="stream-card"]')!;
      expect(card).toHaveClass('opacity-75');
    });

    it('shows staleness badge with time ago when platform is degraded and startedAt is set', () => {
      mockHealthState = { kick: 'degraded', twitch: 'healthy', anyDegraded: true };
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      renderWithProviders(
        <StreamCard stream={fixtures.stream({ platform: 'kick', startedAt: fiveMinAgo })} />
      );
      const badge = screen.getByTestId('staleness-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(/\d+m ago/);
    });

    it('applies reduced opacity when platform is down', () => {
      mockHealthState = { kick: 'healthy', twitch: 'down', anyDegraded: false };
      const { container } = renderWithProviders(
        <StreamCard stream={fixtures.stream({ platform: 'twitch' })} />
      );
      const card = container.querySelector('[data-testid="stream-card"]')!;
      expect(card).toHaveClass('opacity-75');
    });

    it('shows staleness badge when platform is down', () => {
      mockHealthState = { kick: 'healthy', twitch: 'down', anyDegraded: false };
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      renderWithProviders(
        <StreamCard stream={fixtures.stream({ platform: 'twitch', startedAt: tenMinAgo })} />
      );
      const badge = screen.getByTestId('staleness-badge');
      expect(badge).toHaveTextContent(/\d+m ago/);
    });

    it('does not render staleness badge when startedAt is null', () => {
      mockHealthState = { kick: 'degraded', twitch: 'healthy', anyDegraded: true };
      const { container } = renderWithProviders(
        <StreamCard stream={fixtures.stream({ platform: 'kick', startedAt: null })} />
      );
      const card = container.querySelector('[data-testid="stream-card"]')!;
      expect(card).toHaveClass('opacity-75');
      expect(screen.queryByTestId('staleness-badge')).toBeNull();
    });

    it('removes staleness overlay when platform recovers to healthy', () => {
      mockHealthState = { kick: 'degraded', twitch: 'healthy', anyDegraded: true };
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      const { container, rerender } = renderWithProviders(
        <StreamCard stream={fixtures.stream({ platform: 'kick', startedAt: fiveMinAgo })} />
      );
      expect(container.querySelector('[data-testid="stream-card"]')).toHaveClass('opacity-75');
      expect(screen.getByTestId('staleness-badge')).toBeInTheDocument();

      mockHealthState = { kick: 'healthy', twitch: 'healthy', anyDegraded: false };
      rerender(<StreamCard stream={fixtures.stream({ platform: 'kick', startedAt: fiveMinAgo })} />);
      expect(container.querySelector('[data-testid="stream-card"]')).not.toHaveClass('opacity-75');
      expect(screen.queryByTestId('staleness-badge')).toBeNull();
    });

    it('formats hours when startedAt is more than 60 minutes ago', () => {
      mockHealthState = { kick: 'degraded', twitch: 'healthy', anyDegraded: true };
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
      renderWithProviders(
        <StreamCard stream={fixtures.stream({ platform: 'kick', startedAt: twoHoursAgo })} />
      );
      const badge = screen.getByTestId('staleness-badge');
      expect(badge).toHaveTextContent(/\d+h ago/);
    });
  });
});
