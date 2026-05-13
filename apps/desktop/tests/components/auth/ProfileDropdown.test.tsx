import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/hooks/useAuth', () => ({
  useAuthStatus: () => ({
    twitch: { connected: false, loading: false },
    kick: { connected: false, loading: false },
    isAuthenticated: false,
  }),
  useUserInfo: () => ({
    displayName: '',
    hasAnyUser: false,
    twitchUser: null,
    kickUser: null,
  }),
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      isGuest: true,
      loginTwitch: vi.fn(),
      loginKick: vi.fn(),
      logoutTwitch: vi.fn(),
      logoutKick: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

import { ProfileDropdown } from '@/components/auth/ProfileDropdown';

describe('ProfileDropdown', () => {
  it('renders without crashing when guest', () => {
    const { container } = renderWithProviders(<ProfileDropdown />);
    expect(container.firstChild).toBeTruthy();
  });
});
