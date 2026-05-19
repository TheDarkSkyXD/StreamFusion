import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireEvent,
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

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { toast } from 'sonner';
import { ChannelModeratorsTable } from '@/pages/Mod/channel/ChannelModeratorsTable';

interface MockResponse {
  status: number;
  body: unknown;
}

function jsonResponse({ status, body }: MockResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ChannelModeratorsTable', () => {
  beforeEach(() => {
    authState.twitchUser = { id: '111', login: 'me' };
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: 'cid' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it('renders moderators list on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/moderation/moderators')) {
        return jsonResponse({
          status: 200,
          body: {
            data: [
              { user_id: 'u1', user_login: 'mod1', user_name: 'Mod1' },
              { user_id: 'u2', user_login: 'mod2', user_name: 'Mod2' },
            ],
            pagination: {},
          },
        });
      }
      return jsonResponse({ status: 404, body: {} });
    });

    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);

    await waitFor(() =>
      expect(screen.getByTestId('moderator-row-u1')).toBeInTheDocument(),
    );
    expect(screen.getByText('Mod1')).toBeInTheDocument();
    expect(screen.getByText('Mod2')).toBeInTheDocument();
  });

  it('renders empty state when no moderators', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ status: 200, body: { data: [], pagination: {} } }),
    );
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/no moderators yet/i)).toBeInTheDocument(),
    );
  });

  it('shows "showing first 100" footer when pagination cursor present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        status: 200,
        body: {
          data: [{ user_id: 'u1', user_login: 'mod1', user_name: 'Mod1' }],
          pagination: { cursor: 'next' },
        },
      }),
    );
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/showing first 100/i)).toBeInTheDocument(),
    );
  });

  it('Add resolves username and calls addModerator on success', async () => {
    let addModCalled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method as string) ?? 'GET';
      if (url.includes('/moderation/moderators') && method === 'GET') {
        return jsonResponse({
          status: 200,
          body: { data: [], pagination: {} },
        });
      }
      if (url.includes('/users?login=new_mod')) {
        return jsonResponse({
          status: 200,
          body: {
            data: [{ id: 'u9', login: 'new_mod', display_name: 'NewMod' }],
          },
        });
      }
      if (url.includes('/moderation/moderators') && method === 'POST') {
        addModCalled = true;
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ status: 404, body: {} });
    });

    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/no moderators yet/i)).toBeInTheDocument(),
    );

    const input = screen.getByLabelText(/add moderator by username/i);
    fireEvent.change(input, { target: { value: 'new_mod' } });
    fireEvent.click(screen.getByTestId('add-moderator-button'));

    await waitFor(() => expect(addModCalled).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId('moderator-row-u9')).toBeInTheDocument(),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('Add toasts error when user cannot be resolved', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/moderation/moderators')) {
        return jsonResponse({
          status: 200,
          body: { data: [], pagination: {} },
        });
      }
      if (url.includes('/users?login=')) {
        return jsonResponse({ status: 200, body: { data: [] } });
      }
      return jsonResponse({ status: 404, body: {} });
    });

    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/no moderators yet/i)).toBeInTheDocument(),
    );

    const input = screen.getByLabelText(/add moderator by username/i);
    fireEvent.change(input, { target: { value: 'ghost' } });
    fireEvent.click(screen.getByTestId('add-moderator-button'));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('Remove calls removeModerator and drops the row on success', async () => {
    let deleteCalled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method as string) ?? 'GET';
      if (url.includes('/moderation/moderators') && method === 'GET') {
        return jsonResponse({
          status: 200,
          body: {
            data: [{ user_id: 'u1', user_login: 'mod1', user_name: 'Mod1' }],
            pagination: {},
          },
        });
      }
      if (url.includes('/moderation/moderators') && method === 'DELETE') {
        deleteCalled = true;
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ status: 404, body: {} });
    });

    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('moderator-row-u1')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('remove-moderator-button-u1'));

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() =>
      expect(screen.queryByTestId('moderator-row-u1')).not.toBeInTheDocument(),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('surfaces an error when load fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ status: 403, body: { message: 'nope' } }),
    );
    renderWithProviders(<ChannelModeratorsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('channel-moderators-error')).toBeInTheDocument(),
    );
  });
});
