import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const twitchLogin = vi.fn(async () => undefined);
const kickLogin = vi.fn(async () => undefined);

vi.mock('@/features/auth/data/useAuth', () => ({
  useTwitchAuth: () => ({ login: twitchLogin, loading: false }),
  useKickAuth: () => ({ login: kickLogin, loading: false }),
}));

vi.mock('@/assets/platforms', () => ({
  getPlatformColor: (p: string) => (p === 'twitch' ? '#9146FF' : '#53FC18'),
}));

import { LoginDialog } from '@/features/auth/components/auth/LoginDialog';

// Guards: success state — Twitch login resolves and the dialog closes via onOpenChange(false), so the user doesn't see the dialog hang after a successful round-trip
// Guards: error state — when twitch.login() rejects (OAuth window closed / token-exchange fail / network down), onOpenChange MUST NOT fire so the dialog stays open and the user can retry without re-opening it
// Guards: closed prop — open=false hides the dialog entirely; protects against the regression where a stale open-state leaves the dialog mounted offscreen
describe('LoginDialog', () => {
  it('renders title and twitch button when open', () => {
    render(<LoginDialog open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByText(/welcome to streamfusion/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with twitch/i })).toBeInTheDocument();
  });

  it('calls twitch.login and closes when twitch button clicked', async () => {
    const onOpenChange = vi.fn();
    render(<LoginDialog open={true} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: /continue with twitch/i }));
    await waitFor(() => expect(twitchLogin).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders nothing when closed', () => {
    render(<LoginDialog open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByText(/welcome to streamfusion/i)).not.toBeInTheDocument();
  });

  it('error: when twitch.login() rejects (OAuth window closed / network down), the dialog stays open (onOpenChange not called)', async () => {
    // The handler does `await twitch.login(); onOpenChange(false);` — when the
    // first await throws, the second statement is skipped, so the dialog stays
    // open. The SUT's async event handler also surfaces an unhandled rejection
    // because React invokes click handlers as fire-and-forget. We catch it on
    // process.unhandledRejection for the duration of this assertion so it
    // doesn't poison the suite.
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      twitchLogin.mockImplementationOnce(async () => {
        throw new Error('OAuth window closed');
      });
      const onOpenChange = vi.fn();
      render(<LoginDialog open={true} onOpenChange={onOpenChange} />);
      fireEvent.click(screen.getByRole('button', { name: /continue with twitch/i }));
      await waitFor(() => expect(twitchLogin).toHaveBeenCalled());
      // Let microtasks settle so the rejected promise gets observed.
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The handler's `await twitch.login()` threw, so onOpenChange(false) was
      // never reached. The dialog stays open and the user can retry.
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      // And the only unhandled rejection (if any) is the one from the OAuth
      // failure — not a different bug.
      for (const r of rejections) {
        expect(String(r)).toMatch(/OAuth window closed/);
      }
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
