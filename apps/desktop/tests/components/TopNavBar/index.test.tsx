import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

const setSidebarCollapsed = vi.fn();
const appStoreState = { sidebarCollapsed: false, setSidebarCollapsed };
vi.mock('@/store/app-store', () => ({
  // TopNavBar now uses selector form: useAppStore((s) => s.sidebarCollapsed).
  // Support both call shapes so the test doesn't care which the component uses.
  useAppStore: (selector?: (s: typeof appStoreState) => unknown) =>
    typeof selector === 'function' ? selector(appStoreState) : appStoreState,
}));

vi.mock('@/components/TopNavBar/SearchBar', () => ({
  SearchBar: () => <div data-testid="search-bar">search</div>,
}));

vi.mock('@/components/TopNavBar/NotificationsDropdown', () => ({
  NotificationsDropdown: () => <div data-testid="notifications">notif</div>,
}));

vi.mock('@/components/auth', () => ({
  ProfileDropdown: () => <div data-testid="profile">profile</div>,
}));

import { TopNavBar } from '@/components/TopNavBar';

describe('TopNavBar', () => {
  it('renders brand, search, notifications, profile', () => {
    renderWithProviders(<TopNavBar />);
    expect(screen.getByText('StreamFusion')).toBeInTheDocument();
    expect(screen.getByTestId('search-bar')).toBeInTheDocument();
    expect(screen.getByTestId('notifications')).toBeInTheDocument();
    expect(screen.getByTestId('profile')).toBeInTheDocument();
  });

  it('toggles sidebar when menu button clicked', () => {
    renderWithProviders(<TopNavBar />);
    fireEvent.click(screen.getByTitle(/collapse sidebar|expand sidebar/i));
    expect(setSidebarCollapsed).toHaveBeenCalledWith(true, true);
  });
});
