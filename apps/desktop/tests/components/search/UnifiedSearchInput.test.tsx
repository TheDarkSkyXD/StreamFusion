import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/hooks/queries/useSearch', () => ({
  // Infinite-query shape: data.pages is an array of pages.
  useSearchChannels: () => ({
    data: { pages: [] },
    isLoading: false,
    fetchNextPage: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useSearchCategories: () => ({
    data: { pages: [] },
    isLoading: false,
    fetchNextPage: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
}));

vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: <T,>(v: T) => v,
}));

vi.mock('@/hooks/useSearchHistory', () => ({
  useSearchHistory: () => ({
    history: [],
    addSearch: vi.fn(),
    removeSearch: vi.fn(),
    clearSearch: vi.fn(),
  }),
}));

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { UnifiedSearchInput } from '@/components/search/UnifiedSearchInput';

describe('UnifiedSearchInput', () => {
  it('renders an input with the placeholder', () => {
    renderWithProviders(<UnifiedSearchInput placeholder="Search the world" />);
    expect(screen.getByPlaceholderText('Search the world')).toBeInTheDocument();
  });

  it('honors initialValue', () => {
    renderWithProviders(<UnifiedSearchInput initialValue="ninja" />);
    expect(screen.getByDisplayValue('ninja')).toBeInTheDocument();
  });

  it('calls onSearch when Enter is pressed', () => {
    const onSearch = vi.fn();
    renderWithProviders(<UnifiedSearchInput onSearch={onSearch} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'xqc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSearch).toHaveBeenCalledWith('xqc');
  });
});
