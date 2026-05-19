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
import { ChannelUnbanRequests } from '@/pages/Mod/channel/ChannelUnbanRequests';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SAMPLE_REQ = {
  id: 'ur-1',
  broadcaster_id: '222',
  broadcaster_login: 'b',
  broadcaster_name: 'B',
  moderator_id: null,
  moderator_login: null,
  moderator_name: null,
  user_id: 'u1',
  user_login: 'viewer',
  user_name: 'Viewer',
  text: 'sorry, please unban',
  status: 'pending',
  created_at: '2026-05-18T00:00:00Z',
  resolved_at: null,
  resolution_text: null,
};

describe('ChannelUnbanRequests', () => {
  beforeEach(() => {
    authState.twitchUser = { id: '111', login: 'me' };
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: 'cid' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
    (toast.success as ReturnType<typeof vi.fn>).mockClear();
    (toast.error as ReturnType<typeof vi.fn>).mockClear();
  });

  it('renders pending unban requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { data: [SAMPLE_REQ], pagination: {} }),
    );
    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('unban-request-row-ur-1')).toBeInTheDocument(),
    );
    expect(screen.getByText('sorry, please unban')).toBeInTheDocument();
    expect(screen.getByText('Viewer')).toBeInTheDocument();
  });

  it('renders empty state when no requests', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, { data: [], pagination: {} }),
    );
    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(
        screen.getByText(/no pending unban requests/i),
      ).toBeInTheDocument(),
    );
  });

  it('Approve flow PATCHes with status=approved and forwards resolution_text', async () => {
    let lastPatchUrl: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method as string) ?? 'GET';
      if (method === 'GET') {
        return jsonResponse(200, { data: [SAMPLE_REQ], pagination: {} });
      }
      if (method === 'PATCH') {
        lastPatchUrl = url;
        return jsonResponse(200, {
          data: [{ ...SAMPLE_REQ, status: 'approved' }],
        });
      }
      return jsonResponse(404, {});
    });

    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('unban-request-row-ur-1')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('unban-approve-button-ur-1'));
    const textarea = await screen.findByLabelText(/resolution text/i);
    fireEvent.change(textarea, { target: { value: 'all good' } });
    fireEvent.click(screen.getByTestId('unban-confirm-approved-ur-1'));

    await waitFor(() => expect(lastPatchUrl).not.toBeNull());
    expect(lastPatchUrl).toContain('status=approved');
    expect(lastPatchUrl).toContain('resolution_text=all+good');
    expect(lastPatchUrl).toContain('unban_request_id=ur-1');
    await waitFor(() =>
      expect(
        screen.queryByTestId('unban-request-row-ur-1'),
      ).not.toBeInTheDocument(),
    );
  });

  it('Deny flow PATCHes with status=denied', async () => {
    let lastPatchUrl: string | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const method = (init?.method as string) ?? 'GET';
      if (method === 'GET') {
        return jsonResponse(200, { data: [SAMPLE_REQ], pagination: {} });
      }
      if (method === 'PATCH') {
        lastPatchUrl = url;
        return jsonResponse(200, {
          data: [{ ...SAMPLE_REQ, status: 'denied' }],
        });
      }
      return jsonResponse(404, {});
    });

    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('unban-request-row-ur-1')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('unban-deny-button-ur-1'));
    fireEvent.click(screen.getByTestId('unban-confirm-denied-ur-1'));

    await waitFor(() => expect(lastPatchUrl).not.toBeNull());
    expect(lastPatchUrl).toContain('status=denied');
    // No resolution text → not in URL.
    expect(lastPatchUrl).not.toContain('resolution_text=');
  });

  it('changing status filter triggers a new GET with the new status', async () => {
    const urls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      urls.push(url);
      return jsonResponse(200, { data: [], pagination: {} });
    });

    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(urls.some((u) => u.includes('status=pending'))).toBe(true),
    );

    fireEvent.change(screen.getByTestId('unban-requests-status-filter'), {
      target: { value: 'approved' },
    });

    await waitFor(() =>
      expect(urls.some((u) => u.includes('status=approved'))).toBe(true),
    );
  });

  it('surfaces an error when load fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(403, { message: 'no access' }),
    );
    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(
        screen.getByTestId('channel-unban-requests-error'),
      ).toBeInTheDocument(),
    );
  });
});
