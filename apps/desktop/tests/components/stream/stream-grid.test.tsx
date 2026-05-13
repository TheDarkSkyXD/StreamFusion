import { describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/components/stream/stream-card', () => ({
  StreamCard: ({ stream }: { stream: { title: string } }) => (
    <div data-testid="stream-card">{stream.title}</div>
  ),
}));

vi.mock('@/components/stream/stream-card-skeleton', () => ({
  StreamCardSkeleton: () => <div data-testid="stream-skeleton" />,
}));

import { StreamGrid } from '@/components/stream/stream-grid';

describe('StreamGrid', () => {
  it('renders skeletons when loading', () => {
    renderWithProviders(<StreamGrid isLoading skeletons={3} />);
    expect(screen.getAllByTestId('stream-skeleton')).toHaveLength(3);
  });

  it('renders empty message when streams is empty', () => {
    renderWithProviders(<StreamGrid streams={[]} emptyMessage="Nothing live" />);
    expect(screen.getByText('Nothing live')).toBeInTheDocument();
  });

  it('renders one StreamCard per stream', () => {
    renderWithProviders(
      <StreamGrid
        streams={[
          fixtures.stream({ id: '1', title: 'A' }),
          fixtures.stream({ id: '2', title: 'B' }),
        ]}
      />
    );
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});
