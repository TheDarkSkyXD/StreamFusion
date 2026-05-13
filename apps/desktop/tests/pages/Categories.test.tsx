import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, fixtures, renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/hooks/queries/useCategories', () => ({
  useTopCategories: vi.fn(),
  useCategoryById: vi.fn(),
}));

vi.mock('@/components/discovery/virtualized-category-grid', () => ({
  VirtualizedCategoryGrid: ({
    categories,
    isLoading,
    emptyMessage,
  }: {
    categories: { id: string; name: string }[];
    isLoading?: boolean;
    emptyMessage?: string;
  }) => (
    <div data-testid="vcat-grid">
      {isLoading ? (
        <span>loading-grid</span>
      ) : categories.length === 0 ? (
        <span>{emptyMessage}</span>
      ) : (
        categories.map((c) => <div key={c.id}>{c.name}</div>)
      )}
    </div>
  ),
}));

import { useTopCategories } from '@/hooks/queries/useCategories';
import { CategoriesPage } from '@/pages/Categories';

const useTopCategoriesMock = vi.mocked(useTopCategories);

describe('CategoriesPage', () => {
  beforeEach(() => {
    useTopCategoriesMock.mockReset();
  });

  it('renders title and forwards loading state to grid', () => {
    useTopCategoriesMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useTopCategories
    >);
    renderWithProviders(<CategoriesPage />);
    expect(screen.getByRole('heading', { name: /categories/i })).toBeInTheDocument();
    expect(screen.getByText('loading-grid')).toBeInTheDocument();
  });

  it('renders categories from query', () => {
    useTopCategoriesMock.mockReturnValue({
      data: [fixtures.category({ id: 'c1', name: 'Just Chatting' }), fixtures.category({ id: 'c2', name: 'GTA V' })],
      isLoading: false,
    } as ReturnType<typeof useTopCategories>);
    renderWithProviders(<CategoriesPage />);
    expect(screen.getByText('Just Chatting')).toBeInTheDocument();
    expect(screen.getByText('GTA V')).toBeInTheDocument();
  });

  it('filters categories via the search input', () => {
    useTopCategoriesMock.mockReturnValue({
      data: [fixtures.category({ id: 'c1', name: 'Just Chatting' }), fixtures.category({ id: 'c2', name: 'GTA V' })],
      isLoading: false,
    } as ReturnType<typeof useTopCategories>);
    renderWithProviders(<CategoriesPage />);
    const input = screen.getByPlaceholderText(/filter categories/i);
    fireEvent.change(input, { target: { value: 'gta' } });
    expect(screen.queryByText('Just Chatting')).not.toBeInTheDocument();
    expect(screen.getByText('GTA V')).toBeInTheDocument();
  });

  it('passes a query-aware empty message when filter has no hits', () => {
    useTopCategoriesMock.mockReturnValue({
      data: [fixtures.category({ id: 'c1', name: 'Just Chatting' })],
      isLoading: false,
    } as ReturnType<typeof useTopCategories>);
    renderWithProviders(<CategoriesPage />);
    fireEvent.change(screen.getByPlaceholderText(/filter categories/i), {
      target: { value: 'nothing-matches' },
    });
    expect(screen.getByText(/no categories matching "nothing-matches"/i)).toBeInTheDocument();
  });
});
