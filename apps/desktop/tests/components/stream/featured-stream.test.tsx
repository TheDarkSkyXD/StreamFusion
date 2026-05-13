import { describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div data-testid="featured-img">{alt}</div>,
}));

import { FeaturedStream } from '@/components/stream/featured-stream';

describe('FeaturedStream', () => {
  it('renders loading skeleton when isLoading', () => {
    const { container } = renderWithProviders(<FeaturedStream isLoading={true} />);
    expect(container.querySelector('[class*="rounded-xl"]')).toBeInTheDocument();
  });

  it('renders nothing when no stream and not loading', () => {
    const { container } = renderWithProviders(<FeaturedStream />);
    expect(container.firstChild).toBeNull();
  });

  it('renders title and live badge when a stream is provided', () => {
    renderWithProviders(<FeaturedStream stream={fixtures.stream({ title: 'My Featured', isLive: true })} />);
    expect(screen.getAllByText(/my featured/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Live$/i)).toBeInTheDocument();
  });
});
