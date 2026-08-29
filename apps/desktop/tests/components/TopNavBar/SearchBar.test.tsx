import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  ...routerMock(),
  useNavigate: () => navigate,
}));

vi.mock('@/features/discovery/components/search/UnifiedSearchInput', () => ({
  UnifiedSearchInput: ({
    inputClassName,
    placeholder,
    onSearch,
  }: {
    inputClassName?: string;
    placeholder?: string;
    onSearch?: (t: string) => void;
  }) => (
    <button type="button" data-input-class={inputClassName} onClick={() => onSearch?.('foo')}>
      {placeholder}
    </button>
  ),
}));

import { SearchBar } from '@/features/shell/components/TopNavBar/SearchBar';

// Guards: submitting the global search field keeps the query while navigating to search results.
describe('SearchBar', () => {
  it('wires onSearch to navigate to /search', () => {
    renderWithProviders(<SearchBar />);
    const btn = screen.getByText(/search streamfusion/i);
    btn.click();
    expect(navigate).toHaveBeenCalledWith({ to: '/search', search: { q: 'foo' } });
  });
});
