import { describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/discovery/category-card', () => ({
  CategoryCard: ({ category }: { category: { name: string } }) => (
    <div data-testid="cat-card">{category.name}</div>
  ),
}));

vi.mock('@/components/discovery/category-card-skeleton', () => ({
  CategoryCardSkeleton: () => <div data-testid="cat-skeleton" />,
}));

import { VirtualizedCategoryGrid } from '@/components/discovery/virtualized-category-grid';

describe('VirtualizedCategoryGrid', () => {
  it('renders skeletons when loading + empty', () => {
    renderWithProviders(<VirtualizedCategoryGrid categories={[]} isLoading skeletonCount={5} />);
    expect(screen.getAllByTestId('cat-skeleton').length).toBe(5);
  });

  it('renders the empty message when not loading and empty', () => {
    renderWithProviders(<VirtualizedCategoryGrid categories={[]} emptyMessage="nada" />);
    expect(screen.getByText('nada')).toBeInTheDocument();
  });

  it('renders some category cards from a list', () => {
    const categories = Array.from({ length: 6 }).map((_, i) =>
      fixtures.category({ id: `${i}`, name: `Cat ${i}` })
    );
    renderWithProviders(<VirtualizedCategoryGrid categories={categories} />);
    expect(screen.getAllByTestId('cat-card').length).toBeGreaterThan(0);
  });
});
