import { fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BUFFER_PREFERENCES, DEFAULT_PLAYER_CONTROLS_PREFERENCES } from '@/shared/auth-types';

import { renderWithProviders, routerMock, screen, userEvent } from '../test-utils';

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
// playerControls carries a non-default sibling (showQuality:false) so the spread-
// preservation assertion below has something to prove: toggling one field must keep it.
const playerControls = { ...DEFAULT_PLAYER_CONTROLS_PREFERENCES, showQuality: false };
// buffer carries a non-default sibling (liveSyncDurationCount:5) for the same reason.
const buffer = { ...DEFAULT_BUFFER_PREFERENCES, liveSyncDurationCount: 5 };
vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      preferences: { playback: { defaultQuality: 'auto', autoplay: true }, playerControls, buffer },
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

describe('SettingsPage — Player controls tab (U9)', () => {
  beforeEach(() => {
    updatePreferences.mockReset();
  });

  // Opens the Player controls tab via its sidebar item. The sidebar label is the
  // only "Player controls" text until the tab is active (the Playback tab shows by default).
  async function openPlayerControlsTab() {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await user.click(screen.getByText('Player controls'));
    return user;
  }

  it('toggling a control persists to playerControls with the spread preserved', async () => {
    const user = await openPlayerControlsTab();

    // Toggle "Volume" — find its row, then the switch inside it.
    const row = screen.getByText('Volume').closest('div');
    const toggle = row?.parentElement?.querySelector('[role="switch"]');
    expect(toggle).toBeTruthy();
    await user.click(toggle as Element);

    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(updatePreferences).toHaveBeenCalledWith({
      playerControls: {
        ...playerControls,
        // Default is true; clicking the (default-true) switch flips it to false.
        showVolume: false,
      },
    });
    // Spread preserved: the non-default sibling survives the single-field write.
    const arg = updatePreferences.mock.calls[0][0] as {
      playerControls: typeof playerControls;
    };
    expect(arg.playerControls.showQuality).toBe(false);
  });

  it('does not render a Picture-in-Picture toggle', async () => {
    await openPlayerControlsTab();

    expect(screen.queryByText(/picture-in-picture/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/picture in picture/i)).not.toBeInTheDocument();
    // Exactly six controls are surfaced (PiP omitted): Quality, Playback speed,
    // Volume, Fullscreen, Theater, Video Stats.
    expect(screen.getAllByRole('switch')).toHaveLength(6);
  });
});

describe('SettingsPage — Buffer tab (U10)', () => {
  beforeEach(() => {
    updatePreferences.mockReset();
  });

  async function openBufferTab() {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await user.click(screen.getByText('Buffer'));
    return user;
  }

  it('toggling low-latency persists to buffer with the spread preserved', async () => {
    const user = await openBufferTab();

    // The only switch in the Buffer tab is low-latency mode.
    const toggle = screen.getByRole('switch');
    await user.click(toggle);

    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(updatePreferences).toHaveBeenCalledWith({
      buffer: { ...buffer, lowLatencyMode: false },
    });
    // Spread preserved: the non-default sibling survives the single-field write.
    const arg = updatePreferences.mock.calls[0][0] as { buffer: typeof buffer };
    expect(arg.buffer.liveSyncDurationCount).toBe(5);
  });

  it('changing a range control persists the parsed number with the spread preserved', async () => {
    await openBufferTab();

    // "Forward buffer" range maps to maxBufferLengthSec.
    const slider = screen.getByLabelText('Forward buffer') as HTMLInputElement;
    // userEvent doesn't drive <input type=range> well; fire a native change.
    fireEvent.change(slider, { target: { value: '42' } });

    // The handler is async (await updatePreferences -> setSaved); waitFor flushes
    // the resulting state update so no act(...) warning leaks.
    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith({
        buffer: { ...buffer, maxBufferLengthSec: 42 },
      });
    });
    expect(updatePreferences).toHaveBeenCalledTimes(1);
  });

  it('reset to defaults writes DEFAULT_BUFFER_PREFERENCES', async () => {
    const user = await openBufferTab();

    await user.click(screen.getByRole('button', { name: /reset to defaults/i }));

    expect(updatePreferences).toHaveBeenCalledWith({
      buffer: { ...DEFAULT_BUFFER_PREFERENCES },
    });
  });

  it('states that changes apply on the next stream load', async () => {
    await openBufferTab();
    expect(screen.getByText(/changes apply when the stream next loads/i)).toBeInTheDocument();
  });
});
