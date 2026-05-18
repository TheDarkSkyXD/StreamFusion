import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// U29 — the /mod nav-link reads `twitchModeratedChannelIds.size` from this
// store. Each test reassigns `moderatedIds` so the selector returns a fresh
// snapshot every render.
let moderatedIds = new Set<string>();
vi.mock('@/store/moderated-channels-store', () => ({
  useModeratedChannelsStore: (
    selector: (s: { twitchModeratedChannelIds: Set<string> }) => unknown,
  ) => selector({ twitchModeratedChannelIds: moderatedIds }),
}));

import { TopNavBar } from '@/components/TopNavBar';

describe('TopNavBar', () => {
  beforeEach(() => {
    moderatedIds = new Set();
  });

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

  it('hides the /mod nav link when the user moderates no channels', () => {
    moderatedIds = new Set();
    renderWithProviders(<TopNavBar />);
    expect(screen.queryByTestId('mod-nav-link')).not.toBeInTheDocument();
  });

  it('shows the /mod nav link when the user moderates ≥1 channel', () => {
    moderatedIds = new Set(['111']);
    renderWithProviders(<TopNavBar />);
    const link = screen.getByTestId('mod-nav-link');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('data-to', '/mod');
  });
});
