import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

vi.mock('@/hooks', () => ({
  useAppVersion: () => '1.0.0-test',
  useAppVersionInfo: () => ({ name: 'StreamFusion', version: '1.0.0-test' }),
  useUpdater: () => ({
    status: 'idle',
    updateInfo: null,
    progress: null,
    error: null,
    allowPrerelease: false,
    isChecking: false,
    isDownloading: false,
    isUpdateAvailable: false,
    isUpdateDownloaded: false,
    hasError: false,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    setAllowPrerelease: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuthError: () => ({ error: null, clearError: vi.fn() }),
}));

const updatePreferences = vi.fn();
vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      preferences: { playback: { defaultQuality: 'auto', autoplay: true } },
      updatePreferences,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/store/adblock-store', () => ({
  useAdBlockStore: (selector?: (s: unknown) => unknown) => {
    const state = { enableAdBlock: true, setEnableAdBlock: vi.fn() };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/auth', () => ({
  AccountConnect: () => <div data-testid="account-connect">accounts</div>,
}));

import { SettingsPage } from '@/pages/Settings';

describe('SettingsPage', () => {
  beforeEach(() => {
    updatePreferences.mockReset();
  });

  it('renders the page heading', () => {
    renderWithProviders(<SettingsPage />);
    // The page mounts a settings layout with a sidebar of categories; the
    // h1 is fine for a smoke check.
    expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0);
  });

  it('renders the tabs sidebar (Playback, Accounts, etc.)', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getAllByText(/playback/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/accounts/i).length).toBeGreaterThan(0);
  });
});
