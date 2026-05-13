import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtures, installElectronAPIMock, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div data-testid="boxart">{alt}</div>,
}));

import { CategoryCard } from '@/components/discovery/category-card';

describe('CategoryCard', () => {
  beforeEach(() => {
    installElectronAPIMock();
  });

  it('renders the category name and box art', () => {
    renderWithProviders(<CategoryCard category={fixtures.category({ name: 'Just Chatting' })} />);
    // Box-art alt + heading both contain "Just Chatting".
    expect(screen.getAllByText('Just Chatting').length).toBeGreaterThan(0);
    expect(screen.getByTestId('boxart')).toHaveTextContent('Just Chatting');
  });

  it('shows viewer count when > 0', () => {
    renderWithProviders(<CategoryCard category={fixtures.category({ viewerCount: 25_000 })} />);
    expect(screen.getByText(/25K viewers/i)).toBeInTheDocument();
  });

  it('hides viewer count when 0 or undefined', () => {
    renderWithProviders(<CategoryCard category={fixtures.category({ viewerCount: 0 })} />);
    expect(screen.queryByText(/viewers/i)).not.toBeInTheDocument();
  });
});
