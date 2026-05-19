import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { installElectronAPIMock } from '../test-utils';

import { useResolveTwitchChannel } from '@/hooks/useResolveTwitchChannel';

describe('useResolveTwitchChannel', () => {
  beforeEach(() => {
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: 'cid' };
    const api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: 'tok' }));
  });

  it('returns null for falsy input', async () => {
    const { result } = renderHook(() => useResolveTwitchChannel(null));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it('resolves login to id on 200 OK', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ id: '99', login: 'ninja', display_name: 'Ninja' }],
        }),
        { status: 200 },
      ),
    );
    const { result } = renderHook(() => useResolveTwitchChannel('ninja'));
    await waitFor(() => expect(result.current).toEqual({
      id: '99',
      login: 'ninja',
      displayName: 'Ninja',
    }));
    fetchSpy.mockRestore();
  });

  it('returns null on 404', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('not found', { status: 404 }));
    const { result } = renderHook(() => useResolveTwitchChannel('ghost'));
    await waitFor(() => expect(result.current).toBeNull());
    fetchSpy.mockRestore();
  });

  it('returns null on 401', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
    const { result } = renderHook(() => useResolveTwitchChannel('locked'));
    await waitFor(() => expect(result.current).toBeNull());
    fetchSpy.mockRestore();
  });

  it('returns null on empty Helix data array', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const { result } = renderHook(() => useResolveTwitchChannel('nope'));
    await waitFor(() => expect(result.current).toBeNull());
    fetchSpy.mockRestore();
  });
});
