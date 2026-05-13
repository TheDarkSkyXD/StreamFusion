import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock({ search: { q: 'ninja' } }));

vi.mock('@/hooks/queries/useSearch', () => ({
  useSearchAll: vi.fn(),
}));

vi.mock('@/components/stream/stream-grid', () => ({
  StreamGrid: ({ streams }: { streams?: unknown[] }) => (
    <div data-testid="stream-grid">{streams?.length ?? 0} streams</div>
  ),
}));

vi.mock('@/components/discovery/category-grid', () => ({
  CategoryGrid: ({ categories }: { categories?: unknown[] }) => (
    <div data-testid="category-grid">{categories?.length ?? 0} categories</div>
  ),
}));

vi.mock('@/components/ui/platform-avatar', () => ({
  PlatformAvatar: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { useSearchAll } from '@/hooks/queries/useSearch';
import { SearchPage } from '@/pages/SearchResults';

const useSearchAllMock = vi.mocked(useSearchAll);

function emptyResults() {
  return { channels: [], streams: [], videos: [], clips: [], categories: [] };
}

describe('SearchPage', () => {
  beforeEach(() => {
    useSearchAllMock.mockReset();
  });

  it('renders the search header for a non-empty query with no hits', () => {
    useSearchAllMock.mockReturnValue({ data: emptyResults(), isLoading: false } as unknown as ReturnType<typeof useSearchAll>);
    renderWithProviders(<SearchPage />);
    expect(screen.getByText(/search results for/i)).toBeInTheDocument();
    expect(screen.getByText(/found 0 results/i)).toBeInTheDocument();
  });

  it('renders streams returned by the search API', () => {
    useSearchAllMock.mockReturnValue({
      data: {
        ...emptyResults(),
        streams: [fixtures.stream({ id: 'a' }), fixtures.stream({ id: 'b' })],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    renderWithProviders(<SearchPage />);
    expect(screen.getByTestId('stream-grid')).toHaveTextContent('2 streams');
  });

  it('renders categories returned by the search API', () => {
    useSearchAllMock.mockReturnValue({
      data: {
        ...emptyResults(),
        categories: [fixtures.category({ id: 'c1' })],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useSearchAll>);
    renderWithProviders(<SearchPage />);
    expect(screen.getByTestId('category-grid')).toHaveTextContent('1 categories');
  });
});
