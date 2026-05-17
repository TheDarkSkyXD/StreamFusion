import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

// Hoisted state lets each test override the mocked infinite-query return
// (data shape, hasNextPage, fetchNextPage spy) without re-registering
// vi.mock — the factory closes over these references.
const searchMockState = vi.hoisted(() => ({
  channelsData: { pages: [] as { data: unknown[] }[] },
  channelsHasNextPage: false,
  channelsFetchNextPage: vi.fn(),
  categoriesData: { pages: [] as { data: unknown[] }[] },
  categoriesHasNextPage: false,
  categoriesFetchNextPage: vi.fn(),
}));

vi.mock('@/hooks/queries/useSearch', () => ({
  useSearchChannels: () => ({
    data: searchMockState.channelsData,
    isLoading: false,
    fetchNextPage: searchMockState.channelsFetchNextPage,
    hasNextPage: searchMockState.channelsHasNextPage,
    isFetchingNextPage: false,
  }),
  useSearchCategories: () => ({
    data: searchMockState.categoriesData,
    isLoading: false,
    fetchNextPage: searchMockState.categoriesFetchNextPage,
    hasNextPage: searchMockState.categoriesHasNextPage,
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

vi.mock('@/hooks/queries/useCategories', () => ({
  useUnifiedCategoryLink: () => ({
    linkPlatform: 'twitch',
    linkCategoryId: 'cat-1',
    otherId: undefined,
  }),
}));

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { UnifiedSearchInput } from '@/components/search/UnifiedSearchInput';

function makeChannels(count: number, prefix = 'ch') {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    platform: 'twitch' as const,
    username: `${prefix}${i}`,
    displayName: `${prefix.toUpperCase()}${i}`,
    avatarUrl: '',
    bio: undefined,
    isLive: false,
    isVerified: false,
    isPartner: false,
    followerCount: 0,
  }));
}

function resetSearchMock() {
  searchMockState.channelsData = { pages: [] };
  searchMockState.channelsHasNextPage = false;
  searchMockState.channelsFetchNextPage = vi.fn();
  searchMockState.categoriesData = { pages: [] };
  searchMockState.categoriesHasNextPage = false;
  searchMockState.categoriesFetchNextPage = vi.fn();
}

describe('UnifiedSearchInput', () => {
  beforeEach(() => {
    resetSearchMock();
  });

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

describe('UnifiedSearchInput — dropdown 100-cap and Show more CTA', () => {
  beforeEach(() => {
    resetSearchMock();
  });

  function openDropdown(initialValue: string, onSearch = vi.fn()) {
    renderWithProviders(
      <UnifiedSearchInput initialValue={initialValue} onSearch={onSearch} />
    );
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    return { input, onSearch };
  }

  it('renders "See all results for X" when result count is below the 100-cap', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(30) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown('ninja');
    expect(screen.getByText('See all results for "ninja"')).toBeInTheDocument();
    expect(screen.queryByText('Show more results for "ninja"')).not.toBeInTheDocument();
  });

  it('flips footer to "Show more results for X" when combined results hit the cap AND more remain', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown('ninja');
    expect(screen.getByText('Show more results for "ninja"')).toBeInTheDocument();
    expect(screen.queryByText('See all results for "ninja"')).not.toBeInTheDocument();
  });

  it('keeps the "See all results" copy when cap is reached BUT no more results remain', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    searchMockState.channelsHasNextPage = false;
    openDropdown('ninja');
    expect(screen.getByText('See all results for "ninja"')).toBeInTheDocument();
    expect(screen.queryByText('Show more results for "ninja"')).not.toBeInTheDocument();
  });

  it('routes the footer click through onSearch — same destination whether capped or not', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    searchMockState.channelsHasNextPage = true;
    const { onSearch } = openDropdown('ninja');
    fireEvent.click(screen.getByText('Show more results for "ninja"'));
    expect(onSearch).toHaveBeenCalledWith('ninja');
  });

  it('does NOT trigger fetchNextPage on near-bottom scroll when cap is reached', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(100) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown('ninja');

    const scrollable = document.querySelector('div.overflow-y-auto') as HTMLElement | null;
    expect(scrollable).not.toBeNull();
    if (!scrollable) return;

    Object.defineProperty(scrollable, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollable, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollable, 'scrollTop', { value: 1700, configurable: true });
    fireEvent.scroll(scrollable);

    expect(searchMockState.channelsFetchNextPage).not.toHaveBeenCalled();
    expect(searchMockState.categoriesFetchNextPage).not.toHaveBeenCalled();
  });

  it('DOES trigger fetchNextPage on near-bottom scroll when below the cap and more pages exist', () => {
    searchMockState.channelsData = { pages: [{ data: makeChannels(30) }] };
    searchMockState.channelsHasNextPage = true;
    openDropdown('ninja');

    const scrollable = document.querySelector('div.overflow-y-auto') as HTMLElement | null;
    expect(scrollable).not.toBeNull();
    if (!scrollable) return;

    Object.defineProperty(scrollable, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollable, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(scrollable, 'scrollTop', { value: 1700, configurable: true });
    fireEvent.scroll(scrollable);

    expect(searchMockState.channelsFetchNextPage).toHaveBeenCalledTimes(1);
  });
});
