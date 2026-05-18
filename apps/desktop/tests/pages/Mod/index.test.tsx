import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireEvent,
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
} from '../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

const mocks = vi.hoisted(() => ({
  hydrate: vi.fn(
    async (_selfUserId: string, _accessToken: string, _clientId: string) => {},
  ),
  moderatedIds: new Set<string>(),
  authState: {
    twitchUser: { id: '111', login: 'streamer' } as { id: string; login: string } | null,
  },
}));

vi.mock('@/store/moderated-channels-store', () => {
  const useStore = (
    selector: (s: { twitchModeratedChannelIds: Set<string> }) => unknown,
  ) => selector({ twitchModeratedChannelIds: mocks.moderatedIds });
  // biome-ignore lint/suspicious/noExplicitAny: store.getState shim.
  (useStore as any).getState = () => ({
    hydrate: mocks.hydrate,
    twitchModeratedChannelIds: mocks.moderatedIds,
  });
  return { useModeratedChannelsStore: useStore };
});

vi.mock('@/store/auth-store', () => {
  const useStore = (selector: (s: typeof mocks.authState) => unknown) =>
    selector(mocks.authState);
  // biome-ignore lint/suspicious/noExplicitAny: store.getState shim.
  (useStore as any).getState = () => mocks.authState;
  return { useAuthStore: useStore };
});

// Child sections — keep this test focused on the shell.
vi.mock('@/pages/Mod/PerChannelSettings', () => ({
  PerChannelSettings: () => <div data-testid="per-channel-settings">per-channel</div>,
}));
vi.mock('@/pages/Mod/BannedUserSearch', () => ({
  BannedUserSearch: () => <div data-testid="banned-user-search">search</div>,
}));
vi.mock('@/pages/Mod/EngagementAggregate', () => ({
  EngagementAggregate: () => <div data-testid="engagement-aggregate">engage</div>,
}));

import { ModPage } from '@/pages/Mod';

describe('ModPage', () => {
  beforeEach(() => {
    mocks.hydrate.mockClear();
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: 'cid' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
  });

  it('renders the three sections under the Moderation heading', () => {
    renderWithProviders(<ModPage />);
    expect(screen.getByRole('heading', { name: /moderation/i })).toBeInTheDocument();
    expect(screen.getByTestId('per-channel-settings')).toBeInTheDocument();
    expect(screen.getByTestId('banned-user-search')).toBeInTheDocument();
    expect(screen.getByTestId('engagement-aggregate')).toBeInTheDocument();
  });

  it('refresh button triggers moderated-channels hydrate', async () => {
    renderWithProviders(<ModPage />);
    fireEvent.click(screen.getByRole('button', { name: /refresh moderation data/i }));
    // Hydrate is async — wait for microtasks to flush.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.hydrate).toHaveBeenCalled();
    // Verify the call shape — selfUserId and access token are the load-bearing
    // bits; client-id comes from import.meta.env which is statically resolved.
    const callArgs = mocks.hydrate.mock.calls[0] as [string, string, string];
    expect(callArgs[0]).toBe('111');
    expect(callArgs[1]).toBe('tok');
    expect(typeof callArgs[2]).toBe('string');
    expect(callArgs[2].length).toBeGreaterThan(0);
  });
});
