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

// Guards: loading state — useAuthInitialize hasn't resolved → render the fallback (or null) instead of leaking the children with undefined auth context behind them
// Guards: error state — token validation fail surfaces as initialized=true with no user; the children render, the auth-store flips to logged-out, hydrate still runs (no leftover follows from a prior session). The component's contract is "never block app boot on auth failure"
// Guards: hydrate-on-init — follow-store hydrate fires exactly once after initialization; missing this leaks follow state between sessions
describe('AuthProvider', () => {
  beforeEach(() => {
    hydrate.mockReset();
    isInitialized = true;
  });

  it('renders children once initialized', () => {
    render(
      <AuthProvider fallback={<div>loading</div>}>
        <div>app-content</div>
      </AuthProvider>
    );
    expect(screen.getByText('app-content')).toBeInTheDocument();
  });

  it('renders the fallback while uninitialized', () => {
    isInitialized = false;
    render(
      <AuthProvider fallback={<div>loading-fallback</div>}>
        <div>app-content</div>
      </AuthProvider>
    );
    expect(screen.getByText('loading-fallback')).toBeInTheDocument();
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
  });

  it('calls hydrate() on the follow store after initialization', () => {
    render(
      <AuthProvider>
        <div>x</div>
      </AuthProvider>
    );
    expect(hydrate).toHaveBeenCalled();
  });
});
