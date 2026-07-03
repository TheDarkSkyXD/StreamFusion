import { fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PROXY_PREFERENCES,
} from '@/shared/auth-types';
import {
  HOME_CAROUSEL_INTERVAL_DEFAULT_MS,
  useAppStore,
} from '@/store/app-store';
import { useFollowStore } from '@/store/follow-store';

import {
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  userEvent,
} from '../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

// Updater hook stub. The Updates-tab assertions need to read back the auto-check
// state and assert on the setters, so the mock is backed by hoisted spies +
// mutable state the tests can drive.
const updaterMock = vi.hoisted(() => ({
  state: {
    autoCheckEnabled: false,
    checkFrequency: 'daily' as 'hourly' | 'daily' | 'weekly',
  },
  setAllowPrerelease: vi.fn(),
  setAutoCheckEnabled: vi.fn(),
  setCheckFrequency: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useAppVersion: () => '1.0.0-test',
  useAppVersionInfo: () => ({ name: 'StreamFusion', version: '1.0.0-test' }),
  useUpdater: () => ({
    status: 'idle',
    updateInfo: null,
    progress: null,
    error: null,
    allowPrerelease: false,
    autoCheckEnabled: updaterMock.state.autoCheckEnabled,
    checkFrequency: updaterMock.state.checkFrequency,
    isChecking: false,
    isDownloading: false,
    isUpdateAvailable: false,
    isUpdateDownloaded: false,
    hasError: false,
    checkForUpdates: updaterMock.checkForUpdates,
    downloadUpdate: updaterMock.downloadUpdate,
    installUpdate: updaterMock.installUpdate,
    setAllowPrerelease: updaterMock.setAllowPrerelease,
    setAutoCheckEnabled: updaterMock.setAutoCheckEnabled,
    setCheckFrequency: updaterMock.setCheckFrequency,
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuthError: () => ({ error: null, clearError: vi.fn() }),
}));

const updatePreferences = vi.fn();
// playerControls carries a non-default sibling (showQuality:false) so the spread-
// preservation assertion below has something to prove: toggling one field must keep it.
const playerControls = { ...DEFAULT_PLAYER_CONTROLS_PREFERENCES, showQuality: false };
// buffer carries non-default siblings for the same reason.
const buffer = { ...DEFAULT_BUFFER_PREFERENCES, liveSyncDurationCount: 5, lowLatencyMode: true };
// proxy carries the main-owned `hasCredentials:true` advisory — it is NOT part of
// the apply config, so a save's `{...proxyPrefs, ...config}` write must preserve it.
const proxy = { ...DEFAULT_PROXY_PREFERENCES, hasCredentials: true };
// playbackAdvanced carries a non-default sibling (allowHevc:true) so the U13
// spread-preservation assertion has something to prove.
const playbackAdvanced = { ...DEFAULT_PLAYBACK_ADVANCED_PREFERENCES, allowHevc: true };
const notificationPreferences = {
  ...DEFAULT_NOTIFICATION_PREFERENCES,
  twitch: false,
};
// Login actions for the API/Tokens "Reconnect" buttons (U14).
const loginTwitch = vi.fn();
const loginKick = vi.fn();
vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      preferences: {
        playback: { defaultQuality: 'auto', autoplay: true },
        playerControls,
        buffer,
        proxy,
        playbackAdvanced,
        notifications: notificationPreferences,
      },
      updatePreferences,
      loginTwitch,
      loginKick,
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
    useAppStore.setState({ homeCarouselIntervalMs: HOME_CAROUSEL_INTERVAL_DEFAULT_MS });
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

describe('SettingsPage — Playback featured carousel', () => {
  beforeEach(() => {
    updatePreferences.mockReset();
    useAppStore.setState({ homeCarouselIntervalMs: HOME_CAROUSEL_INTERVAL_DEFAULT_MS });
  });

  it('changing the timing slider updates the persisted home carousel interval', () => {
    renderWithProviders(<SettingsPage />);

    const slider = screen.getByLabelText('Featured carousel timing') as HTMLInputElement;
    expect(slider).toHaveValue('15');

    fireEvent.change(slider, { target: { value: '45' } });

    expect(useAppStore.getState().homeCarouselIntervalMs).toBe(45_000);
  });

  it('clamps the timing number input to the supported range', () => {
    renderWithProviders(<SettingsPage />);

    const input = screen.getByLabelText('Featured carousel timing seconds') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    expect(useAppStore.getState().homeCarouselIntervalMs).toBe(15_000);

    fireEvent.change(input, { target: { value: '180' } });
    expect(useAppStore.getState().homeCarouselIntervalMs).toBe(120_000);
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

// Guards: Settings must expose a dedicated Notifications tab with the global Live Notification controls users need before any live-source service runs.
describe('SettingsPage — Notifications tab', () => {
  beforeEach(() => {
    updatePreferences.mockReset();
    notificationPreferences.perChannelNotifications = {};
    useFollowStore.setState({ localFollows: [], sourceByKey: new Map() });
  });

  async function openNotificationsTab() {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await user.click(screen.getByText('Notifications'));
    return user;
  }

  it('renders the Notifications tab and global notification toggles', async () => {
    await openNotificationsTab();

    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('Desktop notifications')).toBeInTheDocument();
    expect(screen.getByText('Live Notifications')).toBeInTheDocument();
    expect(screen.getByText('Twitch')).toBeInTheDocument();
    expect(screen.getByText('Kick')).toBeInTheDocument();
    expect(screen.getByText('Guest Follow notifications')).toBeInTheDocument();
    expect(screen.getByText('Toast notifications')).toBeInTheDocument();
    expect(screen.getByText('Sound')).toBeInTheDocument();
    expect(screen.getByText('Favorites-only')).toBeInTheDocument();
    expect(screen.getByText('Restart grace')).toBeInTheDocument();
  });

  it('toggling a platform preserves the rest of the notification preference group', async () => {
    const user = await openNotificationsTab();

    const row = screen.getByText('Kick').closest('div');
    const toggle = row?.parentElement?.querySelector('[role="switch"]');
    expect(toggle).toBeTruthy();
    await user.click(toggle as Element);

    expect(updatePreferences).toHaveBeenCalledWith({
      notifications: {
        ...notificationPreferences,
        kick: false,
      },
    });
    const arg = updatePreferences.mock.calls[0][0] as {
      notifications: typeof notificationPreferences;
    };
    expect(arg.notifications.twitch).toBe(false);
  });

  it('persists desktop and sound notification toggles to the live notification preference group', async () => {
    const user = await openNotificationsTab();

    const desktopRow = screen.getByText('Desktop notifications').closest('div');
    const desktopToggle = desktopRow?.parentElement?.querySelector('[role="switch"]');
    expect(desktopToggle).toBeTruthy();
    await user.click(desktopToggle as Element);

    const soundRow = screen.getByText('Sound').closest('div');
    const soundToggle = soundRow?.parentElement?.querySelector('[role="switch"]');
    expect(soundToggle).toBeTruthy();
    await user.click(soundToggle as Element);

    expect(updatePreferences).toHaveBeenCalledWith({
      notifications: {
        ...notificationPreferences,
        enabled: false,
      },
    });
    expect(updatePreferences).toHaveBeenCalledWith({
      notifications: {
        ...notificationPreferences,
        sound: false,
      },
    });
  });

  it('persists toast notification toggles independently from bell history', async () => {
    const user = await openNotificationsTab();

    const toastRow = screen.getByText('Toast notifications').closest('div');
    const toastToggle = toastRow?.parentElement?.querySelector('[role="switch"]');
    expect(toastToggle).toBeTruthy();
    await user.click(toastToggle as Element);

    expect(updatePreferences).toHaveBeenCalledWith({
      notifications: {
        ...notificationPreferences,
        toastAlerts: false,
      },
    });
  });

  it('persists Guest Follow notification and favorites-only toggles', async () => {
    const user = await openNotificationsTab();

    const guestRow = screen.getByText('Guest Follow notifications').closest('div');
    const guestToggle = guestRow?.parentElement?.querySelector('[role="switch"]');
    expect(guestToggle).toBeTruthy();
    await user.click(guestToggle as Element);

    const favoritesRow = screen.getByText('Favorites-only').closest('div');
    const favoritesToggle = favoritesRow?.parentElement?.querySelector('[role="switch"]');
    expect(favoritesToggle).toBeTruthy();
    await user.click(favoritesToggle as Element);

    expect(updatePreferences).toHaveBeenCalledWith({
      notifications: {
        ...notificationPreferences,
        guestFollows: false,
      },
    });
    expect(updatePreferences).toHaveBeenCalledWith({
      notifications: {
        ...notificationPreferences,
        favoriteChannelsOnly: true,
      },
    });
  });

  it('persists restart grace selections', async () => {
    const user = await openNotificationsTab();

    await user.click(screen.getByLabelText('Restart grace'));
    await user.click(screen.getByRole('option', { name: '15 minutes' }));

    expect(updatePreferences).toHaveBeenCalledWith({
      notifications: {
        ...notificationPreferences,
        restartGracePeriodMinutes: 15,
      },
    });
  });

  it('renders followed-channel notification controls and persists per-channel changes', async () => {
    useFollowStore.setState({
      localFollows: [
        {
          id: 'chan-1',
          platform: 'twitch',
          username: 'proofstreamer',
          displayName: 'ProofStreamer',
          avatarUrl: '',
          bannerUrl: '',
          bio: '',
          isLive: false,
          isVerified: false,
          isPartner: false,
        },
      ],
      sourceByKey: new Map([['twitch:chan-1', 'guest']]),
    });

    const user = await openNotificationsTab();

    expect(screen.getByText('ProofStreamer')).toBeInTheDocument();
    const toggle = screen.getByLabelText('Notifications for ProofStreamer');
    await user.click(toggle);

    expect(updatePreferences).toHaveBeenCalledWith({
      notifications: {
        ...notificationPreferences,
        perChannelNotifications: {
          'twitch:chan-1': false,
        },
      },
    });
  });

  it('filters followed-channel notification rows and collapses the list', async () => {
    useFollowStore.setState({
      localFollows: [
        {
          id: 'chan-1',
          platform: 'twitch',
          username: 'proofstreamer',
          displayName: 'ProofStreamer',
          avatarUrl: '',
          bannerUrl: '',
          bio: '',
          isLive: false,
          isVerified: false,
          isPartner: false,
        },
        {
          id: 'chan-2',
          platform: 'kick',
          username: 'quietcaster',
          displayName: 'QuietCaster',
          avatarUrl: '',
          bannerUrl: '',
          bio: '',
          isLive: false,
          isVerified: false,
          isPartner: false,
        },
      ],
      sourceByKey: new Map([
        ['twitch:chan-1', 'guest'],
        ['kick:chan-2', 'guest'],
      ]),
    });

    const user = await openNotificationsTab();

    await user.type(screen.getByLabelText('Search followed channels'), 'quiet');
    expect(screen.queryByText('ProofStreamer')).not.toBeInTheDocument();
    expect(screen.getByText('QuietCaster')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide followed channels' }));
    expect(screen.queryByLabelText('Search followed channels')).not.toBeInTheDocument();
    expect(screen.queryByText('QuietCaster')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show followed channels' }));
    expect(screen.getByLabelText('Search followed channels')).toBeInTheDocument();
    expect(screen.getByText('QuietCaster')).toBeInTheDocument();
  });

  it('renders desktop notification fallback status and degraded source coverage', async () => {
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'denied' },
    });
    const api = installElectronAPIMock();
    api.notifications.getCoverageStatus = vi.fn(async () => ({
      desktop: { supported: true, permission: 'unknown' },
      platforms: {
        twitch: {
          status: 'degraded',
          issues: [
            {
              platform: 'twitch',
              reason: 'eventsub-failed',
              message: 'Twitch EventSub unavailable',
              safeContext: { channelId: '123' },
              firstSeenAt: 1_000,
              lastSeenAt: 1_000,
            },
          ],
        },
        kick: { status: 'normal', issues: [] },
      },
    }));

    await openNotificationsTab();

    await waitFor(() => expect(api.notifications.getCoverageStatus).toHaveBeenCalled());
    expect(screen.getByText('Desktop notifications blocked')).toBeInTheDocument();
    expect(screen.getByText('Twitch coverage degraded')).toBeInTheDocument();
    expect(screen.getByText('Twitch EventSub unavailable')).toBeInTheDocument();
    expect(screen.getByText('Kick coverage normal')).toBeInTheDocument();
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

describe('SettingsPage — Advanced stream-token (U13, under Playback)', () => {
  beforeEach(() => {
    updatePreferences.mockReset();
    localStorage.clear();
  });

  // The Playback tab is the default active tab, so the advanced subsection
  // renders without navigation.

  it('renders the advanced subsection with the persistent danger banner', () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText(/advanced \(stream token\)/i)).toBeInTheDocument();
    // The exact danger framing the plan requires.
    expect(
      screen.getByText(/wrong values can break playback\. defaults match the current configuration/i)
    ).toBeInTheDocument();
    // The three controls.
    expect(screen.getByText(/access-token player type/i)).toBeInTheDocument();
    expect(screen.getByText(/allow hevc/i)).toBeInTheDocument();
    expect(screen.getByText(/stream device id/i)).toBeInTheDocument();
  });

  it('toggling Allow HEVC persists to playbackAdvanced with the spread preserved', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(screen.getByRole('switch', { name: /allow hevc/i }));

    expect(updatePreferences).toHaveBeenCalledTimes(1);
    // The mock seeds allowHevc:true, so the (checked) switch flips it to false.
    expect(updatePreferences).toHaveBeenCalledWith({
      playbackAdvanced: { ...playbackAdvanced, allowHevc: false },
    });
    // Spread preserved: the sibling playerType survives the single-field write.
    const arg = updatePreferences.mock.calls[0][0] as {
      playbackAdvanced: typeof playbackAdvanced;
    };
    expect(arg.playbackAdvanced.playerType).toBe('default');
  });

  it('Randomize writes a new device id to localStorage and shows its prefix', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    expect(localStorage.getItem('twitch_adblock_device_id')).toBeNull();

    await user.click(screen.getByRole('button', { name: /randomize/i }));

    const stored = localStorage.getItem('twitch_adblock_device_id');
    expect(stored).toMatch(/^[a-z0-9]{32}$/);
    // The UI surfaces the first 8 chars of the new id.
    expect(screen.getByText(new RegExp(stored!.slice(0, 8)))).toBeInTheDocument();
    // Randomizing is not a preferences write (device-id isn't an AdBlockConfig field).
    expect(updatePreferences).not.toHaveBeenCalled();
  });
});

describe('SettingsPage — API / Tokens tab (U14)', () => {
  // Install the electronAPI mock with an `auth.tokenStatus` that returns the
  // documented TokenStatusResult shape per platform. The default auto-stub
  // returns `{data:[],error:null}`, which is the wrong shape for this panel.
  function installTokenStatusMock(
    byPlatform: Partial<Record<'twitch' | 'kick', import('@/shared/ipc-channels').TokenStatusResult>>
  ) {
    const api = installElectronAPIMock();
    const tokenStatus = vi.fn(async (platform: 'twitch' | 'kick') => {
      return (
        byPlatform[platform] ?? { platform, connected: false, valid: false }
      );
    });
    api.auth = { tokenStatus };
    return { api, tokenStatus };
  }

  async function openApiTokensTab(
    byPlatform: Partial<Record<'twitch' | 'kick', import('@/shared/ipc-channels').TokenStatusResult>>
  ) {
    const mock = installTokenStatusMock(byPlatform);
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await user.click(screen.getByText('API / Tokens'));
    // Both panels validate on mount — wait for the IPC to have been called.
    await waitFor(() => expect(mock.tokenStatus).toHaveBeenCalledWith('twitch'));
    await waitFor(() => expect(mock.tokenStatus).toHaveBeenCalledWith('kick'));
    return { user, ...mock };
  }

  beforeEach(() => {
    updatePreferences.mockReset();
    loginTwitch.mockReset();
    loginKick.mockReset();
  });

  it('valid state: shows login, user id, expiry, and scopes as badges', async () => {
    const expiresAt = new Date('2099-01-01T00:00:00.000Z').getTime();
    await openApiTokensTab({
      twitch: {
        platform: 'twitch',
        connected: true,
        valid: true,
        login: 'streamer',
        userId: '12345',
        scopes: ['chat:read', 'chat:edit'],
        expiresAt,
      },
      kick: { platform: 'kick', connected: false, valid: false },
    });

    await waitFor(() => expect(screen.getByText('streamer')).toBeInTheDocument());
    expect(screen.getByText('12345')).toBeInTheDocument();
    expect(screen.getByText('chat:read')).toBeInTheDocument();
    expect(screen.getByText('chat:edit')).toBeInTheDocument();
    // Token valid affordance present; the expiry renders as a locale date string.
    expect(screen.getAllByText(/token valid/i).length).toBeGreaterThan(0);
  });

  it('not-connected state: shows "Not signed in" + a link to Integrations', async () => {
    const { user } = await openApiTokensTab({
      twitch: { platform: 'twitch', connected: false, valid: false },
      kick: { platform: 'kick', connected: false, valid: false },
    });

    await waitFor(() => expect(screen.getAllByText(/not signed in/i).length).toBe(2));
    // Clicking "Connect in Integrations" switches to the Integrations tab.
    const links = screen.getAllByText(/connect in integrations/i);
    await user.click(links[0]);
    expect(screen.getByTestId('account-connect')).toBeInTheDocument();
  });

  it('invalid/expired state: shows the message + a Reconnect button that calls the login action', async () => {
    const { user } = await openApiTokensTab({
      twitch: { platform: 'twitch', connected: true, valid: false },
      kick: { platform: 'kick', connected: false, valid: false },
    });

    await waitFor(() =>
      expect(screen.getByText(/token invalid or expired/i)).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: /reconnect/i }));
    expect(loginTwitch).toHaveBeenCalledTimes(1);
    expect(loginKick).not.toHaveBeenCalled();
  });

  it('"Validate now" re-runs the tokenStatus IPC', async () => {
    const { user, tokenStatus } = await openApiTokensTab({
      twitch: { platform: 'twitch', connected: true, valid: false },
      kick: { platform: 'kick', connected: false, valid: false },
    });

    // One call per platform on mount (2 total). Click Twitch's "Validate now".
    const twitchCallsBefore = tokenStatus.mock.calls.filter((c) => c[0] === 'twitch').length;
    const buttons = screen.getAllByRole('button', { name: /validate now/i });
    await user.click(buttons[0]);

    await waitFor(() => {
      const after = tokenStatus.mock.calls.filter((c) => c[0] === 'twitch').length;
      expect(after).toBe(twitchCallsBefore + 1);
    });
  });
});

describe('SettingsPage — Updates tab (U15)', () => {
  beforeEach(() => {
    updaterMock.state.autoCheckEnabled = false;
    updaterMock.state.checkFrequency = 'daily';
    updaterMock.setAutoCheckEnabled.mockReset();
    updaterMock.setCheckFrequency.mockReset();
    updaterMock.setAllowPrerelease.mockReset();
  });

  async function openUpdatesTab() {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await user.click(screen.getByText('Updates'));
    return user;
  }

  it('renders the auto-check toggle and the frequency select', async () => {
    await openUpdatesTab();
    expect(
      screen.getByRole('switch', { name: /automatically check for updates/i })
    ).toBeInTheDocument();
    // The frequency trigger is a Radix combobox labelled "Check frequency".
    expect(screen.getByRole('combobox', { name: /check frequency/i })).toBeInTheDocument();
    // Existing controls remain.
    expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument();
  });

  it('toggling the auto-check switch calls setAutoCheckEnabled', async () => {
    const user = await openUpdatesTab();
    await user.click(screen.getByRole('switch', { name: /automatically check for updates/i }));
    expect(updaterMock.setAutoCheckEnabled).toHaveBeenCalledTimes(1);
    expect(updaterMock.setAutoCheckEnabled).toHaveBeenCalledWith(true);
  });

  it('the frequency select is disabled while auto-check is off', async () => {
    await openUpdatesTab();
    // Radix sets aria-disabled / disabled on the trigger when `disabled`.
    const trigger = screen.getByRole('combobox', { name: /check frequency/i });
    expect(trigger).toBeDisabled();
  });

  it('choosing a frequency (auto-check on) calls setCheckFrequency with the preset', async () => {
    // Enable so the Select is interactive.
    updaterMock.state.autoCheckEnabled = true;
    await openUpdatesTab();

    const trigger = screen.getByRole('combobox', { name: /check frequency/i });
    expect(trigger).not.toBeDisabled();
    // Radix Select opens on click; pick "Weekly".
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('Weekly'));

    expect(updaterMock.setCheckFrequency).toHaveBeenCalledWith('weekly');
  });
});
