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
    twitchUser: { id: '111', login: 'streamer', displayName: 'Streamer' } as
      | { id: string; login: string; displayName: string }
      | null,
    kickUser: null as { id: number; username: string; slug: string } | null,
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

// Stub getModeratedChannels so the ChannelList doesn't hit fetch.
vi.mock('@/backend/api/platforms/twitch/twitch-helix-moderation', () => ({
  getModeratedChannels: vi.fn(async () => [
    {
      broadcaster_id: '222',
      broadcaster_login: 'somebody',
      broadcaster_name: 'Somebody',
    },
  ]),
}));

import { ModPage } from '@/pages/Mod';

describe('ModPage (index)', () => {
  beforeEach(() => {
    mocks.hydrate.mockClear();
    mocks.authState.twitchUser = {
      id: '111',
      login: 'streamer',
      displayName: 'Streamer',
    };
    mocks.authState.kickUser = null;
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: 'cid' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
  });

  it('renders the Moderation heading + channel list + global retention sections', async () => {
    renderWithProviders(<ModPage />);
    expect(
      screen.getByRole('heading', { name: /^moderation$/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('mod-channel-list')).toBeInTheDocument();
    expect(screen.getByTestId('global-retention')).toBeInTheDocument();
  });

  it("renders the broadcaster's own Twitch channel card", async () => {
    renderWithProviders(<ModPage />);
    // Wait a tick for the async getModeratedChannels.
    await new Promise((r) => setTimeout(r, 0));
    expect(
      screen.getByTestId('mod-channel-card-twitch-streamer'),
    ).toBeInTheDocument();
  });

  it('renders the empty state when no users are signed in', () => {
    mocks.authState.twitchUser = null;
    mocks.authState.kickUser = null;
    renderWithProviders(<ModPage />);
    expect(screen.getByTestId('mod-channel-list-empty')).toBeInTheDocument();
  });

  it('refresh button triggers moderated-channels hydrate', async () => {
    renderWithProviders(<ModPage />);
    fireEvent.click(
      screen.getByRole('button', { name: /refresh moderation data/i }),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.hydrate).toHaveBeenCalled();
    const callArgs = mocks.hydrate.mock.calls[0] as [string, string, string];
    expect(callArgs[0]).toBe('111');
    expect(callArgs[1]).toBe('tok');
  });
});
