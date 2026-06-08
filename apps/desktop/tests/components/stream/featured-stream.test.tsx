import { describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div data-testid="featured-img">{alt}</div>,
}));

import { FeaturedStream } from '@/components/stream/featured-stream';

// Guards: loading state — render skeleton variant when isLoading=true so the featured slot doesn't flash a "no stream" panel before data lands
// Guards: error/no-data state — renders null when no stream is provided and not loading; parent decides whether to mount a fallback featured banner or hide entirely
// Guards: success state — stream title + live badge render for a provided stream; users see what's live in the hero panel
describe('FeaturedStream', () => {
  it('loading: renders skeleton variant when isLoading=true', () => {
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
