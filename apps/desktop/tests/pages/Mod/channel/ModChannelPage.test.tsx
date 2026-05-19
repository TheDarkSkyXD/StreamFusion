import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from '../../../test-utils';

vi.mock('@tanstack/react-router', () => routerMock());

const authState = vi.hoisted(() => ({
  twitchUser: { id: '111', login: 'me' } as
    | { id: string; login: string }
    | null,
  kickUser: null as { id: number; username: string; slug: string } | null,
}));

vi.mock('@/store/auth-store', () => {
  const useStore = (selector: (s: typeof authState) => unknown) =>
    selector(authState);
  // biome-ignore lint/suspicious/noExplicitAny: store.getState shim.
  (useStore as any).getState = () => authState;
  return { useAuthStore: useStore };
});

// Child sections — keep this test focused on the shell wiring.
vi.mock('@/pages/Mod/channel/ChannelModLogFeed', () => ({
  ChannelModLogFeed: ({ channelId }: { channelId: string }) => (
    <div data-testid="channel-mod-log-feed-stub">{channelId}</div>
  ),
}));
vi.mock('@/pages/Mod/channel/ChannelBannedList', () => ({
  ChannelBannedList: ({
    platform,
    broadcasterId,
  }: {
    platform: string;
    broadcasterId?: string;
  }) => (
    <div
      data-testid="channel-banned-list-stub"
      data-platform={platform}
      data-broadcaster={broadcasterId ?? ''}
    />
  ),
}));
vi.mock('@/pages/Mod/channel/ChannelEngagement', () => ({
  ChannelEngagement: ({ broadcasterId }: { broadcasterId: string }) => (
    <div data-testid="channel-engagement-stub">{broadcasterId}</div>
  ),
}));
vi.mock('@/pages/Mod/channel/RetentionCard', () => ({
  RetentionCard: ({ scope, title }: { scope: string; title: string }) => (
    <div data-testid={`retention-stub-${scope}`}>{title}</div>
  ),
}));

import { ModChannelPage } from '@/pages/Mod/channel/ModChannelPage';

describe('ModChannelPage', () => {
  beforeEach(() => {
    authState.twitchUser = { id: '111', login: 'me' };
    authState.kickUser = null;
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: 'cid' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
  });

  it('shows the resolving placeholder until Twitch channel resolves', async () => {
    // Hang the fetch so we can observe the resolving state.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<ModChannelPage platform="twitch" channel="ninja" />);
    expect(screen.getByTestId('mod-channel-resolving')).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it('renders Twitch sections after resolve (own-broadcaster path enables engagement)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: '111', login: 'me', display_name: 'Me' }],
        }),
        { status: 200 },
      ),
    );
    renderWithProviders(<ModChannelPage platform="twitch" channel="me" />);
    await waitFor(() =>
      expect(
        screen.getByTestId('retention-stub-channel:111'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByTestId('retention-stub-global')).toBeInTheDocument();
    expect(screen.getByTestId('channel-mod-log-feed-stub').textContent).toBe(
      '111',
    );
    expect(
      screen.getByTestId('channel-banned-list-stub').getAttribute('data-platform'),
    ).toBe('twitch');
    expect(screen.getByTestId('channel-engagement-stub')).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it('hides engagement section when signed-in user is not the broadcaster', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: '999', login: 'someone', display_name: 'Someone' }],
        }),
        { status: 200 },
      ),
    );
    renderWithProviders(
      <ModChannelPage platform="twitch" channel="someone" />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('retention-stub-channel:999'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId('channel-engagement-stub'),
    ).not.toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it('Kick page renders without resolving + uses slug as channel id', async () => {
    renderWithProviders(<ModChannelPage platform="kick" channel="Xqc" />);
    // No resolving state.
    expect(
      screen.queryByTestId('mod-channel-resolving'),
    ).not.toBeInTheDocument();
    // Retention scope uses lowercase kick slug.
    expect(
      screen.getByTestId('retention-stub-channel:kick:xqc'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('channel-mod-log-feed-stub').textContent).toBe(
      'xqc',
    );
    expect(
      screen.getByTestId('channel-banned-list-stub').getAttribute('data-platform'),
    ).toBe('kick');
    // No engagement for Kick.
    expect(
      screen.queryByTestId('channel-engagement-stub'),
    ).not.toBeInTheDocument();
  });

  it('shows resolve-failed when Twitch /users returns 404', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    renderWithProviders(<ModChannelPage platform="twitch" channel="ghost" />);
    await waitFor(() =>
      expect(
        screen.getByTestId('mod-channel-resolve-failed'),
      ).toBeInTheDocument(),
    );
    fetchSpy.mockRestore();
  });
});
