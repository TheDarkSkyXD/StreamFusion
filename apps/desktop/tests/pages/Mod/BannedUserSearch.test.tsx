import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireEvent,
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from '../../test-utils';

const mocks = vi.hoisted(() => ({
  getModeratedChannels: vi.fn(async () => [
    { broadcaster_id: '101', broadcaster_login: 'alpha', broadcaster_name: 'Alpha' },
    { broadcaster_id: '102', broadcaster_login: 'bravo', broadcaster_name: 'Bravo' },
  ]),
  searchUserAcrossChannels: vi.fn(),
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (
    selector: (s: { twitchUser: { id: string; login: string } | null }) => unknown,
  ) => selector({ twitchUser: { id: '111', login: 'streamer' } }),
}));

vi.mock('@/backend/api/platforms/twitch/twitch-helix-moderation', () => ({
  getModeratedChannels: mocks.getModeratedChannels,
}));

vi.mock('@/backend/api/platforms/twitch/twitch-helix-bans-cross-channel', () => ({
  searchUserAcrossChannels: mocks.searchUserAcrossChannels,
}));

import { BannedUserSearch } from '@/pages/Mod/BannedUserSearch';

describe('BannedUserSearch', () => {
  beforeEach(() => {
    mocks.searchUserAcrossChannels.mockReset();
    mocks.getModeratedChannels.mockClear();
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: 'cid' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
  });

  it('shows no results until a query is submitted', () => {
    renderWithProviders(<BannedUserSearch />);
    expect(screen.queryByTestId('banned-search-results')).not.toBeInTheDocument();
    expect(screen.queryByTestId('banned-search-empty')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^search$/i })).toBeDisabled();
  });

  it('submits the query and renders results from searchUserAcrossChannels', async () => {
    mocks.searchUserAcrossChannels.mockImplementation(async (opts: {
      onResult?: (r: unknown) => void;
    }) => {
      const r = {
        channelId: '101',
        channelLogin: 'alpha',
        status: 'banned' as const,
        expiresAt: null,
        moderatorLogin: 'mod1',
        reason: 'spam',
      };
      opts.onResult?.(r);
      return [r];
    });
    renderWithProviders(<BannedUserSearch />);
    fireEvent.change(screen.getByLabelText(/username to search/i), {
      target: { value: 'badguy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('banned-result-101')).toBeInTheDocument();
    });
    expect(mocks.searchUserAcrossChannels).toHaveBeenCalled();
    const args = mocks.searchUserAcrossChannels.mock.calls[0][0];
    expect(args.username).toBe('badguy');
    expect(args.channels).toEqual([
      { broadcasterId: '101', broadcasterLogin: 'alpha' },
      { broadcasterId: '102', broadcasterLogin: 'bravo' },
    ]);
  });

  it('renders progressive results as onResult fires', async () => {
    mocks.searchUserAcrossChannels.mockImplementation(async (opts: {
      onResult?: (r: unknown) => void;
    }) => {
      opts.onResult?.({
        channelId: '101',
        channelLogin: 'alpha',
        status: 'banned',
        expiresAt: null,
        moderatorLogin: null,
        reason: null,
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      opts.onResult?.({
        channelId: '102',
        channelLogin: 'bravo',
        status: 'not-banned',
        expiresAt: null,
        moderatorLogin: null,
        reason: null,
      });
      return [
        {
          channelId: '101',
          channelLogin: 'alpha',
          status: 'banned',
          expiresAt: null,
          moderatorLogin: null,
          reason: null,
        },
        {
          channelId: '102',
          channelLogin: 'bravo',
          status: 'not-banned',
          expiresAt: null,
          moderatorLogin: null,
          reason: null,
        },
      ];
    });
    renderWithProviders(<BannedUserSearch />);
    fireEvent.change(screen.getByLabelText(/username to search/i), {
      target: { value: 'badguy' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => {
      expect(screen.getByTestId('banned-result-101')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId('banned-result-102')).toBeInTheDocument();
    });
  });
});
