import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from '../../../test-utils';

import { ChannelModLogFeed } from '@/pages/Mod/channel/ChannelModLogFeed';

describe('ChannelModLogFeed', () => {
  beforeEach(() => {
    installElectronAPIMock();
  });

  it('renders the empty state when mod_log returns nothing', async () => {
    const api = installElectronAPIMock();
    api.modLog.query = vi.fn(async () => []);
    renderWithProviders(<ChannelModLogFeed channelId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/no mod-log entries/i)).toBeInTheDocument(),
    );
  });

  it('renders rows returned by mod_log query', async () => {
    const api = installElectronAPIMock();
    api.modLog.query = vi.fn(async () => [
      {
        id: 1,
        channelId: '222',
        channelSlug: 'somebody',
        action: 'ban',
        targetUserId: 'u9',
        targetUsername: 'troll',
        moderatorUserId: 'm1',
        moderatorUsername: 'mod1',
        durationSeconds: null,
        reason: 'spam',
        createdAt: Date.now(),
      },
    ]);
    renderWithProviders(<ChannelModLogFeed channelId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId('modlog-row')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('modlog-target-username').textContent).toBe(
      'troll',
    );
  });

  it('forwards channelId to the modLog query', async () => {
    const api = installElectronAPIMock();
    // biome-ignore lint/suspicious/noExplicitAny: test stub for IPC fn shape.
    const querySpy = vi.fn(async (..._args: any[]) => []);
    api.modLog.query = querySpy;
    renderWithProviders(<ChannelModLogFeed channelId="abc123" />);
    await waitFor(() => expect(querySpy).toHaveBeenCalled());
    expect(querySpy.mock.calls[0][0]).toMatchObject({ channelId: 'abc123' });
  });

  it('re-queries when refreshCounter changes', async () => {
    const api = installElectronAPIMock();
    const querySpy = vi.fn(async () => []);
    api.modLog.query = querySpy;
    const { rerender } = renderWithProviders(
      <ChannelModLogFeed channelId="x" refreshCounter={0} />,
    );
    await waitFor(() => expect(querySpy).toHaveBeenCalledTimes(1));
    rerender(<ChannelModLogFeed channelId="x" refreshCounter={1} />);
    await waitFor(() => expect(querySpy).toHaveBeenCalledTimes(2));
  });
});
