// Guards: the Settings page must read the `?tab=` search param to pick the
// active tab on mount, so the in-chat gear's "More settings" deep-link
// (/settings?tab=chat, U7) lands on the Chat tab instead of the Playback
// default. A separate file from Settings.test.tsx because the router mock is
// hoisted module-level — this file pins search to { tab: 'chat' }.
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_CHAT_PREFERENCES,
} from '@/shared/auth-types';

import { renderWithProviders, routerMock, screen } from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock({ search: { tab: 'chat' } }));

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

const updatePreferences = vi.fn(async () => {});
const storeState = {
  preferences: {
    chatDisplay: DEFAULT_CHAT_DISPLAY_PREFERENCES,
    chat: DEFAULT_CHAT_PREFERENCES,
  },
  updatePreferences,
};
vi.mock('@/store/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector?: (s: unknown) => unknown) => (selector ? selector(storeState) : storeState),
    { getState: () => storeState }
  ),
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

describe('SettingsPage — ?tab= deep-link', () => {
  it('selects the Chat tab when ?tab=chat is present', () => {
    renderWithProviders(<SettingsPage />);
    // The Chat content block renders its own heading + groups; the
    // "Appearance" group card heading is unique to the Chat tab content.
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Emotes & badges')).toBeInTheDocument();
    expect(screen.getByText('Behavior')).toBeInTheDocument();
  });
});
