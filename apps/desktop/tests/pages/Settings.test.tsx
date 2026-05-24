import { fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PROXY_PREFERENCES,
} from '@/shared/auth-types';

import {
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  userEvent,
} from '../test-utils';

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
// proxy carries the main-owned `hasCredentials:true` advisory — it is NOT part of
// the apply config, so a save's `{...proxyPrefs, ...config}` write must preserve it.
const proxy = { ...DEFAULT_PROXY_PREFERENCES, hasCredentials: true };
vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      preferences: {
        playback: { defaultQuality: 'auto', autoplay: true },
        playerControls,
        buffer,
        proxy,
      },
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

describe('SettingsPage — Proxy tab (U12)', () => {
  // Build the proxy namespace stubs with the documented shapes (the auto-stub
  // returns `{data:[],error:null}`, which is the wrong shape for these). Each
  // test can override a stub before rendering.
  function installProxyMock(overrides?: {
    apply?: ReturnType<typeof vi.fn>;
    setCredentials?: ReturnType<typeof vi.fn>;
    hasCredentials?: ReturnType<typeof vi.fn>;
  }) {
    const api = installElectronAPIMock();
    const proxyApi = {
      apply:
        overrides?.apply ??
        vi.fn(async () => ({ applied: true, cleared: false, hasCredentials: false })),
      setCredentials:
        overrides?.setCredentials ?? vi.fn(async () => ({ hasCredentials: true })),
      hasCredentials:
        overrides?.hasCredentials ?? vi.fn(async () => ({ hasCredentials: false })),
    };
    api.proxy = proxyApi;
    return { api, proxyApi };
  }

  async function openProxyTab(overrides?: Parameters<typeof installProxyMock>[0]) {
    const mock = installProxyMock(overrides);
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await user.click(screen.getByText('Proxy'));
    // Let the mount `hasCredentials()` effect resolve so its state write doesn't
    // leak past the test as an act(...) warning.
    await waitFor(() => expect(mock.proxyApi.hasCredentials).toHaveBeenCalled());
    return { user, ...mock };
  }

  beforeEach(() => {
    updatePreferences.mockReset();
  });

  it('toggling enable + entering host/port persists proxy prefs (spread preserved) and calls apply', async () => {
    const { user, proxyApi } = await openProxyTab();

    await user.click(screen.getByRole('switch', { name: /enable proxy/i }));
    await user.type(screen.getByLabelText('Host'), '127.0.0.1');
    await user.type(screen.getByLabelText('Port'), '8080');
    await user.click(screen.getByRole('button', { name: /save & apply/i }));

    await waitFor(() => {
      expect(updatePreferences).toHaveBeenCalledWith({
        proxy: { ...proxy, enabled: true, host: '127.0.0.1', port: 8080 },
      });
    });
    // Spread preserved: the main-owned advisory survives the host/port/enabled write.
    const arg = updatePreferences.mock.calls[0][0] as { proxy: typeof proxy };
    expect(arg.proxy.hasCredentials).toBe(true);

    expect(proxyApi.apply).toHaveBeenCalledWith({
      enabled: true,
      host: '127.0.0.1',
      port: 8080,
    });
    // No password typed → credentials are never touched.
    expect(proxyApi.setCredentials).not.toHaveBeenCalled();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('enabled with an empty host shows the disabled status, not Saved', async () => {
    // apply reports a no-op clear for the empty-host case.
    const apply = vi.fn(async () => ({ applied: false, cleared: true, hasCredentials: false }));
    const { user } = await openProxyTab({ apply });

    await user.click(screen.getByRole('switch', { name: /enable proxy/i }));
    // Host left empty on purpose.
    await user.click(screen.getByRole('button', { name: /save & apply/i }));

    await waitFor(() => {
      expect(screen.getByText(/proxy disabled \(no host set\)/i)).toBeInTheDocument();
    });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('surfaces an in-section banner when apply returns an error', async () => {
    const apply = vi.fn(async () => ({
      applied: false,
      cleared: true,
      hasCredentials: false,
      error: 'Proxy connection refused',
    }));
    const { user } = await openProxyTab({ apply });

    await user.click(screen.getByRole('switch', { name: /enable proxy/i }));
    await user.type(screen.getByLabelText('Host'), '10.0.0.1');
    await user.type(screen.getByLabelText('Port'), '3128');
    await user.click(screen.getByRole('button', { name: /save & apply/i }));

    await waitFor(() => {
      expect(screen.getByText(/proxy connection refused/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/couldn't apply the proxy/i)).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('shows a numeric validation error for an out-of-range port on blur', async () => {
    const { user } = await openProxyTab();

    const portField = screen.getByLabelText('Port');
    await user.type(portField, '70000');
    fireEvent.blur(portField);

    expect(screen.getByText(/between 1 and 65535/i)).toBeInTheDocument();
  });

  it('password is write-only: saved placeholder shows and submitting without typing sends no password', async () => {
    // hasCredentials() resolves true → the saved placeholder must render.
    const { user, proxyApi } = await openProxyTab({
      hasCredentials: vi.fn(async () => ({ hasCredentials: true })),
    });

    expect(screen.getByPlaceholderText('••••• (saved)')).toBeInTheDocument();

    // Save with host/port but no new password typed.
    await user.type(screen.getByLabelText('Host'), '127.0.0.1');
    await user.type(screen.getByLabelText('Port'), '8080');
    await user.click(screen.getByRole('button', { name: /save & apply/i }));

    await waitFor(() => expect(proxyApi.apply).toHaveBeenCalled());
    // The stored password is left untouched — setCredentials is never called.
    expect(proxyApi.setCredentials).not.toHaveBeenCalled();
  });

  it('sends a newly typed password via setCredentials on save', async () => {
    const { user, proxyApi } = await openProxyTab({
      hasCredentials: vi.fn(async () => ({ hasCredentials: false })),
    });

    await user.type(screen.getByLabelText('Username'), 'bob');
    await user.type(screen.getByLabelText('Password'), 'hunter2');
    await user.click(screen.getByRole('button', { name: /save & apply/i }));

    await waitFor(() => {
      expect(proxyApi.setCredentials).toHaveBeenCalledWith({
        username: 'bob',
        password: 'hunter2',
      });
    });
  });

  it('Clear credentials calls setCredentials(null)', async () => {
    const { user, proxyApi } = await openProxyTab({
      hasCredentials: vi.fn(async () => ({ hasCredentials: true })),
    });

    await user.click(screen.getByRole('button', { name: /clear credentials/i }));

    await waitFor(() => {
      expect(proxyApi.setCredentials).toHaveBeenCalledWith(null);
    });
  });
});
