import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders, screen, waitFor } from '../../test-utils';

// In-memory retention store backed by the `window.electronAPI.retention` IPC
// bridge — mocks the renderer-side surface so we don't need either SQLite or
// the actual preload script in the test runner. Use vi.hoisted to avoid the
// "cannot access X before initialization" hoist-order pitfall.
const mocks = vi.hoisted(() => {
  const settings = new Map<string, number | null>();
  return {
    settings,
    getRetention: vi.fn(async (scope: string) => {
      if (!settings.has(scope)) return undefined;
      return settings.get(scope);
    }),
    setRetention: vi.fn(async (scope: string, days: number | null) => {
      settings.set(scope, days);
    }),
    moderatedIds: { current: new Set<string>() },
  };
});

vi.mock('@/store/moderated-channels-store', () => ({
  useModeratedChannelsStore: (
    selector: (s: { twitchModeratedChannelIds: Set<string> }) => unknown,
  ) => selector({ twitchModeratedChannelIds: mocks.moderatedIds.current }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Install the IPC bridge mock onto window.electronAPI before importing the
// component. PerChannelSettings reads/writes via window.electronAPI.retention.
(globalThis as unknown as { window: Window }).window =
  (globalThis as unknown as { window?: Window }).window ?? ({} as Window);
(window as unknown as { electronAPI: unknown }).electronAPI = {
  retention: {
    get: mocks.getRetention,
    set: mocks.setRetention,
  },
};

import { PerChannelSettings } from '@/pages/Mod/PerChannelSettings';

describe('PerChannelSettings', () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.moderatedIds.current = new Set();
    mocks.getRetention.mockClear();
    mocks.setRetention.mockClear();
  });

  it('renders one card per moderated channel plus the global card', () => {
    mocks.moderatedIds.current = new Set(['111', '222']);
    renderWithProviders(<PerChannelSettings />);
    expect(screen.getByTestId('retention-card-global')).toBeInTheDocument();
    expect(screen.getByTestId('retention-card-channel:111')).toBeInTheDocument();
    expect(screen.getByTestId('retention-card-channel:222')).toBeInTheDocument();
  });

  it('renders the empty state when the user moderates no channels', () => {
    mocks.moderatedIds.current = new Set();
    renderWithProviders(<PerChannelSettings />);
    expect(
      screen.getByText(/you don't moderate any channels yet/i),
    ).toBeInTheDocument();
  });

  it('saves a positive days value via the IPC bridge', async () => {
    renderWithProviders(<PerChannelSettings />);
    const input = screen.getByLabelText(/retention days for global/i);
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.click(screen.getAllByRole('button', { name: /save/i })[0]);
    await waitFor(() =>
      expect(mocks.setRetention).toHaveBeenCalledWith('global', 30),
    );
  });

  it('"Forever" toggle clears days and saves null', async () => {
    renderWithProviders(<PerChannelSettings />);
    const toggle = screen.getByLabelText(/forever toggle for global/i);
    fireEvent.click(toggle);
    fireEvent.click(screen.getAllByRole('button', { name: /save/i })[0]);
    await waitFor(() =>
      expect(mocks.setRetention).toHaveBeenCalledWith('global', null),
    );
  });
});
