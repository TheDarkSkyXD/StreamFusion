import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const twitchLogin = vi.fn(async () => undefined);
const kickLogin = vi.fn(async () => undefined);

vi.mock('@/hooks/useAuth', () => ({
  useTwitchAuth: () => ({ login: twitchLogin, loading: false }),
  useKickAuth: () => ({ login: kickLogin, loading: false }),
}));

vi.mock('@/assets/platforms', () => ({
  getPlatformColor: (p: string) => (p === 'twitch' ? '#9146FF' : '#53FC18'),
}));

import { LoginDialog } from '@/components/auth/LoginDialog';

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
});
