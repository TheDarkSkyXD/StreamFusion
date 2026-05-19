import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from '../../../test-utils';

const authState = vi.hoisted(() => ({
  twitchUser: { id: '111', login: 'me' } as
    | { id: string; login: string }
    | null,
}));

vi.mock('@/store/auth-store', () => {
  const useStore = (selector: (s: typeof authState) => unknown) =>
    selector(authState);
  return { useAuthStore: useStore };
});

import { ChannelBannedList } from '@/pages/Mod/channel/ChannelBannedList';

describe('ChannelBannedList', () => {
  beforeEach(() => {
    authState.twitchUser = { id: '111', login: 'me' };
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: 'cid' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
  });

  it('renders the Kick informational message and skips fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderWithProviders(<ChannelBannedList platform="kick" />);
    expect(
      screen.getByTestId('channel-banned-list-kick'),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('renders banned rows on Twitch 200', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [
            {
              user_id: 'u1',
              user_login: 'badactor',
              user_name: 'BadActor',
              expires_at: '',
              created_at: '2024-01-01T00:00:00Z',
              reason: 'spam',
              moderator_id: 'm1',
              moderator_login: 'mod1',
              moderator_name: 'Mod1',
            },
          ],
        }),
        { status: 200 },
      ),
    );
    renderWithProviders(
      <ChannelBannedList platform="twitch" broadcasterId="222" />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('banned-row-u1')).toBeInTheDocument(),
    );
    expect(screen.getByText('badactor')).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it('surfaces unauthorized on 401', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 401 }));
    renderWithProviders(
      <ChannelBannedList platform="twitch" broadcasterId="222" />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('channel-banned-list-error'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('channel-banned-list-error').textContent,
    ).toMatch(/scope|sign-in/i);
    fetchSpy.mockRestore();
  });

  it('surfaces not-found on 404', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('missing', { status: 404 }));
    renderWithProviders(
      <ChannelBannedList platform="twitch" broadcasterId="222" />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('channel-banned-list-error'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('channel-banned-list-error').textContent,
    ).toMatch(/not found/i);
    fetchSpy.mockRestore();
  });

  it('renders empty state on 200 with no data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    renderWithProviders(
      <ChannelBannedList platform="twitch" broadcasterId="222" />,
    );
    await waitFor(() =>
      expect(screen.getByText(/no banned users/i)).toBeInTheDocument(),
    );
    fetchSpy.mockRestore();
  });
});
