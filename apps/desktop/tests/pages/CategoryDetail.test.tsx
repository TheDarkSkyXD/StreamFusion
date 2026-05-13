import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fixtures,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
} from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock({ params: { platform: 'twitch', categoryId: 'cat-1' }, search: {} }));

vi.mock('@/hooks/queries/useCategories', () => ({
  useCategoryById: vi.fn(),
  useTopCategories: vi.fn(),
}));

vi.mock('@/hooks/queries/useInfiniteStreams', () => ({
  useInfiniteStreamsByCategory: vi.fn(),
}));

vi.mock('@/components/stream/stream-grid', () => ({
  StreamGrid: ({ streams, isLoading, emptyMessage }: { streams: unknown[]; isLoading?: boolean; emptyMessage?: string }) => (
    <div data-testid="stream-grid">
      {isLoading ? 'loading' : streams.length === 0 ? emptyMessage : `${streams.length} streams`}
    </div>
  ),
}));

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div data-testid="proxied-image">{alt}</div>,
}));

import { useCategoryById } from '@/hooks/queries/useCategories';
import { useInfiniteStreamsByCategory } from '@/hooks/queries/useInfiniteStreams';
import { CategoryDetailPage } from '@/pages/CategoryDetail';

const useCategoryByIdMock = vi.mocked(useCategoryById);
const useInfiniteStreamsByCategoryMock = vi.mocked(useInfiniteStreamsByCategory);

function emptyInfinite() {
  return {
    data: { pages: [] },
    isLoading: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>;
}

describe('CategoryDetailPage', () => {
  beforeEach(() => {
    installElectronAPIMock();
    useCategoryByIdMock.mockReset();
    useInfiniteStreamsByCategoryMock.mockReset();
    useInfiniteStreamsByCategoryMock.mockReturnValue(emptyInfinite());
  });

  it('renders the loading skeleton while category is loading', () => {
    useCategoryByIdMock.mockReturnValue({ data: undefined, isLoading: true } as ReturnType<typeof useCategoryById>);
    const { container } = renderWithProviders(<CategoryDetailPage />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders the category name and box art once loaded', () => {
    useCategoryByIdMock.mockReturnValue({
      data: fixtures.category({ name: 'Just Chatting', boxArtUrl: 'https://x.test/box.jpg' }),
      isLoading: false,
    } as ReturnType<typeof useCategoryById>);
    renderWithProviders(<CategoryDetailPage />);
    expect(screen.getByRole('heading', { name: 'Just Chatting' })).toBeInTheDocument();
    expect(screen.getByTestId('proxied-image')).toHaveTextContent('Just Chatting');
  });

  it('renders merged streams across primary + secondary platforms', () => {
    useCategoryByIdMock.mockReturnValue({
      data: fixtures.category({ name: 'GTA V' }),
      isLoading: false,
    } as ReturnType<typeof useCategoryById>);
    useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
      data: { pages: [{ data: [fixtures.stream({ id: 'a', viewerCount: 10 })] }] },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
    useInfiniteStreamsByCategoryMock.mockReturnValueOnce({
      data: { pages: [{ data: [fixtures.stream({ id: 'b', viewerCount: 20 })] }] },
      isLoading: false,
      isFetchingNextPage: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useInfiniteStreamsByCategory>);
    renderWithProviders(<CategoryDetailPage />);
    expect(screen.getByTestId('stream-grid')).toHaveTextContent('2 streams');
  });
});
