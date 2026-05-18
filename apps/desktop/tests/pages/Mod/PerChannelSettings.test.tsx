import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders, screen } from '../../test-utils';

// In-memory dbService double — mocks the renderer-side singleton so we don't
// need the better-sqlite3 native binary in the test runner. Use vi.hoisted to
// avoid the "cannot access X before initialization" hoist-order pitfall.
const mocks = vi.hoisted(() => {
  const settings = new Map<string, number | null>();
  return {
    settings,
    getRetentionSetting: vi.fn((scope: string) => {
      if (!settings.has(scope)) return undefined;
      return settings.get(scope);
    }),
    setRetentionSetting: vi.fn((scope: string, days: number | null) => {
      settings.set(scope, days);
    }),
    moderatedIds: { current: new Set<string>() },
  };
});

vi.mock('@/backend/services/database-service', () => ({
  dbService: {
    getRetentionSetting: mocks.getRetentionSetting,
    setRetentionSetting: mocks.setRetentionSetting,
  },
}));

vi.mock('@/store/moderated-channels-store', () => ({
  useModeratedChannelsStore: (
    selector: (s: { twitchModeratedChannelIds: Set<string> }) => unknown,
  ) => selector({ twitchModeratedChannelIds: mocks.moderatedIds.current }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PerChannelSettings } from '@/pages/Mod/PerChannelSettings';

describe('PerChannelSettings', () => {
  beforeEach(() => {
    mocks.settings.clear();
    mocks.moderatedIds.current = new Set();
    mocks.getRetentionSetting.mockClear();
    mocks.setRetentionSetting.mockClear();
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

  it('saves a positive days value to dbService', () => {
    renderWithProviders(<PerChannelSettings />);
    const input = screen.getByLabelText(/retention days for global/i);
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.click(screen.getAllByRole('button', { name: /save/i })[0]);
    expect(mocks.setRetentionSetting).toHaveBeenCalledWith('global', 30);
  });

  it('"Forever" toggle clears days and saves null', () => {
    renderWithProviders(<PerChannelSettings />);
    const toggle = screen.getByLabelText(/forever toggle for global/i);
    fireEvent.click(toggle);
    fireEvent.click(screen.getAllByRole('button', { name: /save/i })[0]);
    expect(mocks.setRetentionSetting).toHaveBeenCalledWith('global', null);
  });
});
