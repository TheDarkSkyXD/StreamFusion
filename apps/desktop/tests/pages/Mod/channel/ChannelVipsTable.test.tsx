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

const executeMock = vi.fn();

// Guards: VIP roster loading, pagination, mutations, and errors use typed Twitch IPC commands.
describe('ChannelVipsTable', () => {
  beforeEach(() => {
    authState.twitchUser = { id: '111', login: 'me' };
    const api = installElectronAPIMock();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ ok: true, data: { data: [], pagination: {} } });
    api.twitch.execute = executeMock;
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it('renders VIPs on 200', async () => {
    executeMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          { user_id: 'v1', user_login: 'vip1', user_name: 'Vip1' },
          { user_id: 'v2', user_login: 'vip2', user_name: 'Vip2' },
        ],
        pagination: {},
      },
    });
    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('vip-row-v1')).toBeInTheDocument(),
    );
    expect(screen.getByText('Vip2')).toBeInTheDocument();
  });

  it('renders empty state when no VIPs', async () => {
    executeMock.mockResolvedValue({ ok: true, data: { data: [], pagination: {} } });
    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/no vips yet/i)).toBeInTheDocument(),
    );
  });

  it('shows "showing first 100" footer when pagination cursor present', async () => {
    executeMock.mockResolvedValue({
      ok: true,
      data: {
        data: [{ user_id: 'v1', user_login: 'vip1', user_name: 'Vip1' }],
        pagination: { cursor: 'more' },
      },
    });
    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/showing first 100/i)).toBeInTheDocument(),
    );
  });

  it('Add resolves and calls addVip on success', async () => {
    executeMock.mockImplementation(async (command) => {
      if (command.operation === 'get-vips') {
        return { ok: true, data: { data: [], pagination: {} } };
      }
      if (command.operation === 'resolve-channel') {
        return { ok: true, data: { id: 'v9', login: 'new_vip', displayName: 'NewVip' } };
      }
      return { ok: true, data: null };
    });

    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/no vips yet/i)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/add vip by username/i), {
      target: { value: 'new_vip' },
    });
    fireEvent.click(screen.getByTestId('add-vip-button'));

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith({
        operation: 'add-vip',
        broadcasterId: '222',
        userId: 'v9',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('vip-row-v9')).toBeInTheDocument(),
    );
  });

  it('Remove calls removeVip and drops the row', async () => {
    executeMock.mockImplementation(async (command) => {
      if (command.operation === 'get-vips') {
        return { ok: true, data: {
          data: [{ user_id: 'v1', user_login: 'vip1', user_name: 'Vip1' }],
          pagination: {},
        } };
      }
      return { ok: true, data: null };
    });

    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('vip-row-v1')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('remove-vip-button-v1'));

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith({
        operation: 'remove-vip',
        broadcasterId: '222',
        userId: 'v1',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('vip-row-v1')).not.toBeInTheDocument(),
    );
  });

  it('surfaces an error when load fails', async () => {
    executeMock.mockResolvedValue({
      ok: false,
      error: { code: 'unavailable', message: 'nope' },
    });
    renderWithProviders(<ChannelVipsTable broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('channel-vips-error')).toBeInTheDocument(),
    );
  });
});
