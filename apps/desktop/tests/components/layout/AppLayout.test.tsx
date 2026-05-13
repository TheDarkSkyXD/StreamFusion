import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => ({
  ...routerMock(),
  useLocation: () => ({ pathname: '/' }),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuthInitialize: () => true }));

vi.mock('@/store/app-store', () => ({
  useAppStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      sidebarCollapsed: false,
      setSidebarCollapsed: vi.fn(),
      isTheaterModeActive: false,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/TopNavBar', () => ({
  TopNavBar: () => <div data-testid="top-nav">topnav</div>,
}));

vi.mock('@/components/layout/SidebarFollows', () => ({
  SidebarFollows: () => <div data-testid="sidebar-follows">follows</div>,
}));

vi.mock('@/components/layout/TitleBar', () => ({
  TitleBar: () => <div data-testid="title-bar">title</div>,
}));

vi.mock('@/components/player/mini-player', () => ({
  MiniPlayer: () => null,
}));

import { AppLayout } from '@/components/layout/AppLayout';

describe('AppLayout', () => {
  it('renders title bar, top nav, and children', () => {
    renderWithProviders(
      <AppLayout>
        <div>page-content</div>
      </AppLayout>
    );
    expect(screen.getByTestId('title-bar')).toBeInTheDocument();
    expect(screen.getByTestId('top-nav')).toBeInTheDocument();
    expect(screen.getByText('page-content')).toBeInTheDocument();
  });

  it('renders nav links for each route', () => {
    renderWithProviders(
      <AppLayout>
        <div>x</div>
      </AppLayout>
    );
    expect(screen.getAllByText(/home/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/following/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/categories/i).length).toBeGreaterThan(0);
  });
});
