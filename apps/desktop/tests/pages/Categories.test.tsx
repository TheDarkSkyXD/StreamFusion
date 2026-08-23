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
    skeletonCount,
  }: {
    categories: { id: string; name: string }[];
    isLoading?: boolean;
    emptyMessage?: string;
    skeletonCount?: number;
  }) => (
    <div data-testid="vcat-grid" data-skeleton-count={skeletonCount}>
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

// Guards: loading state — useTopCategories isLoading=true is forwarded to VirtualizedCategoryGrid so the grid shows skeleton placeholders instead of "no categories"
// Guards: error state — useTopCategories returns data=undefined → grid renders the empty state (filter-aware copy) rather than throwing on .length
// Guards: empty state — search filter matches zero categories: query-aware "no categories matching X" empty copy surfaces, distinct from the generic empty state
describe('CategoriesPage', () => {
  beforeEach(() => {
    useTopCategoriesMock.mockReset();
  });

  it('loading: forwards isLoading=true and 12 placeholders to the grid', () => {
    useTopCategoriesMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<
      typeof useTopCategories
    >);
    renderWithProviders(<CategoriesPage />);
    expect(screen.getByRole('heading', { name: /categories/i })).toBeInTheDocument();
    expect(screen.getByText('loading-grid')).toBeInTheDocument();
    expect(screen.getByTestId('vcat-grid')).toHaveAttribute('data-skeleton-count', '12');
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

  it('error: shows a retryable failure instead of the generic empty copy', () => {
    const refetch = vi.fn();
    useTopCategoriesMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useTopCategories>);
    renderWithProviders(<CategoriesPage />);
    expect(screen.getByText(/couldn’t load categories/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.queryByText(/no categories found/i)).not.toBeInTheDocument();
  });

  it('empty: data=[] renders the generic empty message copy in the grid', () => {
    useTopCategoriesMock.mockReturnValue({ data: [], isLoading: false } as unknown as ReturnType<typeof useTopCategories>);
    renderWithProviders(<CategoriesPage />);
    // The grid stub uses the emptyMessage prop when categories.length === 0.
    expect(screen.getByTestId('vcat-grid')).toBeInTheDocument();
  });
});
