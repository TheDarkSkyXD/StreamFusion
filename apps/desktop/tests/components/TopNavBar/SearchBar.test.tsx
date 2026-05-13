import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  ...routerMock(),
  useNavigate: () => navigate,
}));

vi.mock('@/components/search/UnifiedSearchInput', () => ({
  UnifiedSearchInput: ({ placeholder, onSearch }: { placeholder?: string; onSearch?: (t: string) => void }) => (
    <button type="button" onClick={() => onSearch?.('foo')}>
      {placeholder}
    </button>
  ),
}));

import { SearchBar } from '@/components/TopNavBar/SearchBar';

describe('SearchBar', () => {
  it('wires onSearch to navigate to /search', () => {
    renderWithProviders(<SearchBar />);
    const btn = screen.getByText(/search streams, channels, categories/i);
    btn.click();
    expect(navigate).toHaveBeenCalledWith({ to: '/search', search: { q: 'foo' } });
  });
});
