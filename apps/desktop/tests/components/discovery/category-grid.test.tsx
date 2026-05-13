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

import { CategoryGrid } from '@/components/discovery/category-grid';

describe('CategoryGrid', () => {
  it('renders skeletons when loading', () => {
    renderWithProviders(<CategoryGrid isLoading skeletons={4} />);
    expect(screen.getAllByTestId('cat-skeleton')).toHaveLength(4);
  });

  it('renders empty message when categories is empty', () => {
    renderWithProviders(<CategoryGrid categories={[]} emptyMessage="No cats" />);
    expect(screen.getByText('No cats')).toBeInTheDocument();
  });

  it('renders one CategoryCard per category', () => {
    renderWithProviders(
      <CategoryGrid
        categories={[fixtures.category({ id: '1', name: 'A' }), fixtures.category({ id: '2', name: 'B' })]}
      />
    );
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});
