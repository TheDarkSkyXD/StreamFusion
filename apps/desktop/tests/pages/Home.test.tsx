import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/hooks/queries/useStreams', () => ({
  useTopStreams: vi.fn(),
  useStreamsByCategory: vi.fn(),
  useFollowedStreams: vi.fn(),
  useStreamByChannel: vi.fn(),
}));

vi.mock('@/components/stream/featured-stream', () => ({
  FeaturedStream: ({ stream, isLoading }: { stream?: { title: string }; isLoading?: boolean }) => (
    <div data-testid="featured-stream">
      {isLoading ? 'loading-featured' : stream?.title ?? 'no-featured'}
    </div>
  ),
}));

vi.mock('@/pages/Home/components/live-now-section', () => ({
  LiveNowSection: ({ streams }: { streams: unknown[] }) => (
    <div data-testid="live-now">streams: {streams.length}</div>
  ),
}));

import { useTopStreams } from '@/hooks/queries/useStreams';
import { HomePage } from '@/pages/Home';

const useTopStreamsMock = vi.mocked(useTopStreams);

describe('HomePage', () => {
  beforeEach(() => {
    useTopStreamsMock.mockReset();
  });

  it('shows loading state passed to featured + live-now while fetching', () => {
    useTopStreamsMock.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useTopStreams>);
    renderWithProviders(<HomePage />);
    expect(screen.getByTestId('featured-stream')).toHaveTextContent('loading-featured');
    expect(screen.getByTestId('live-now')).toHaveTextContent('streams: 0');
  });

  it('renders featured stream + remaining streams when data arrives', () => {
    const streams = [
      fixtures.stream({ id: 's1', title: 'Featured!' }),
      fixtures.stream({ id: 's2', title: 'Second' }),
      fixtures.stream({ id: 's3', title: 'Third' }),
    ];
    useTopStreamsMock.mockReturnValue({ data: streams, isLoading: false, error: null } as unknown as ReturnType<typeof useTopStreams>);
    renderWithProviders(<HomePage />);
    expect(screen.getByTestId('featured-stream')).toHaveTextContent('Featured!');
    expect(screen.getByTestId('live-now')).toHaveTextContent('streams: 2');
  });

  it('shows error state with retry button on query failure', () => {
    useTopStreamsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    } as unknown as ReturnType<typeof useTopStreams>);
    renderWithProviders(<HomePage />);
    expect(screen.getByText(/failed to load streams/i)).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders the Browse All Categories link', () => {
    useTopStreamsMock.mockReturnValue({ data: [], isLoading: false, error: null } as unknown as ReturnType<typeof useTopStreams>);
    renderWithProviders(<HomePage />);
    expect(screen.getByText(/browse all categories/i)).toBeInTheDocument();
  });
});
