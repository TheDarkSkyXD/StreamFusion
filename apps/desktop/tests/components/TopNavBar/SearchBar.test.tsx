import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  ...routerMock(),
  useNavigate: () => navigate,
}));

vi.mock('@/components/search/UnifiedSearchInput', () => ({
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

import { SearchBar } from '@/components/TopNavBar/SearchBar';

describe('SearchBar', () => {
  it('wires onSearch to navigate to /search', () => {
    renderWithProviders(<SearchBar />);
    const btn = screen.getByText(/search streamfusion/i);
    btn.click();
    expect(navigate).toHaveBeenCalledWith({ to: '/search', search: { q: 'foo' } });
  });

  it('uses the KickTalk input background color', () => {
    renderWithProviders(<SearchBar />);
    expect(screen.getByText(/search streamfusion/i)).toHaveAttribute(
      'data-input-class',
      expect.stringContaining('!bg-[#191919]')
    );
  });

  it('uses the KickTalk placeholder neutral', () => {
    renderWithProviders(<SearchBar />);
    expect(screen.getByText(/search streamfusion/i)).toHaveAttribute(
      'data-input-class',
      expect.stringContaining('placeholder:!text-white/30')
    );
  });

  it('uses the StreamFusion navbar search placeholder', () => {
    renderWithProviders(<SearchBar />);
    expect(screen.getByText('Search StreamFusion...')).toBeInTheDocument();
  });
});
