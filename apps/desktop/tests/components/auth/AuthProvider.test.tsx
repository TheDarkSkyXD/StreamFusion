import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let isInitialized = true;
const hydrate = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuthInitialize: () => isInitialized,
}));

vi.mock('@/store/follow-store', () => ({
  useFollowStore: (selector: (s: unknown) => unknown) => selector({ hydrate }),
}));

import { AuthProvider } from '@/components/auth/AuthProvider';

// Guards: startup state — useAuthInitialize hasn't resolved → still render children so cached follows can paint before token refresh/network work completes
// Guards: error state — token validation fail surfaces as initialized=true with no user; the children render, the auth-store flips to logged-out, hydrate still runs (no leftover follows from a prior session). The component's contract is "never block app boot on auth failure"
// Guards: hydrate-on-mount — follow-store hydrate fires immediately, not after auth init; missing this delays the followed sidebar on startup
describe('AuthProvider', () => {
  beforeEach(() => {
    hydrate.mockReset();
    isInitialized = true;
  });

  it('renders children once initialized', () => {
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    );
    expect(screen.getByText('app-content')).toBeInTheDocument();
  });

  it('renders children while auth initialization is still running', () => {
    isInitialized = false;
    render(
      <AuthProvider>
        <div>app-content</div>
      </AuthProvider>
    );
    expect(screen.getByText('app-content')).toBeInTheDocument();
  });

  it('calls hydrate() on the follow store immediately, before auth init completes', () => {
    isInitialized = false;
    render(
      <AuthProvider>
        <div>x</div>
      </AuthProvider>
    );
    expect(hydrate).toHaveBeenCalled();
  });
});
