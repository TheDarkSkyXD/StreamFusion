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
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';
import { ChannelVipsTable } from '@/pages/Mod/channel/ChannelVipsTable';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ChannelVipsTable', () => {
  beforeEach(() => {
    authState.twitchUser = { id: '111', login: 'me' };
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: 'cid' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it('renders VIPs on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        data: [
          { user_id: 'v1', user_login: 'vip1', user_name: 'Vip1' },
          { user_id: 'v2', user_login: 'vip2', user_name: 'Vip2' },
        ],
        pagination: {},
      }),
    );
    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('vip-row-v1')).toBeInTheDocument(),
    );
    expect(screen.getByText('Vip2')).toBeInTheDocument();
  });

  it('renders empty state when no VIPs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { data: [], pagination: {} }),
    );
    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/no vips yet/i)).toBeInTheDocument(),
    );
  });

  it('shows "showing first 100" footer when pagination cursor present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        data: [{ user_id: 'v1', user_login: 'vip1', user_name: 'Vip1' }],
        pagination: { cursor: 'more' },
      }),
    );
    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/showing first 100/i)).toBeInTheDocument(),
    );
  });

  it('Add resolves and calls addVip on success', async () => {
    let postCalled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method as string) ?? 'GET';
      if (url.includes('/channels/vips') && method === 'GET') {
        return jsonResponse(200, { data: [], pagination: {} });
      }
      if (url.includes('/users?login=new_vip')) {
        return jsonResponse(200, {
          data: [{ id: 'v9', login: 'new_vip', display_name: 'NewVip' }],
        });
      }
      if (url.includes('/channels/vips') && method === 'POST') {
        postCalled = true;
        return new Response(null, { status: 204 });
      }
      return jsonResponse(404, {});
    });

    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/no vips yet/i)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/add vip by username/i), {
      target: { value: 'new_vip' },
    });
    fireEvent.click(screen.getByTestId('add-vip-button'));

    await waitFor(() => expect(postCalled).toBe(true));
    await waitFor(() =>
      expect(screen.getByTestId('vip-row-v9')).toBeInTheDocument(),
    );
  });

  it('Remove calls removeVip and drops the row', async () => {
    let deleteCalled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method as string) ?? 'GET';
      if (url.includes('/channels/vips') && method === 'GET') {
        return jsonResponse(200, {
          data: [{ user_id: 'v1', user_login: 'vip1', user_name: 'Vip1' }],
          pagination: {},
        });
      }
      if (url.includes('/channels/vips') && method === 'DELETE') {
        deleteCalled = true;
        return new Response(null, { status: 204 });
      }
      return jsonResponse(404, {});
    });

    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('vip-row-v1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('remove-vip-button-v1'));

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() =>
      expect(screen.queryByTestId('vip-row-v1')).not.toBeInTheDocument(),
    );
  });

  it('surfaces an error when load fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(403, { message: 'nope' }),
    );
    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('channel-vips-error')).toBeInTheDocument(),
    );
  });
});
