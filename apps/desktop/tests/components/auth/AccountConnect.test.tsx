import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAuth', () => ({
  useTwitchAuth: () => ({ connected: false, user: null, loading: false, login: vi.fn(), logout: vi.fn() }),
  useKickAuth: () => ({ connected: false, user: null, loading: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock('@/assets/platforms', () => ({
  getPlatformColor: () => '#9146FF',
}));

vi.mock('@/components/ui/proxied-image', () => ({
  ProxiedImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

vi.mock('@/components/icons', () => ({
  TwitchIcon: () => <span>TwitchIcon</span>,
  KickIcon: () => <span>KickIcon</span>,
}));

import { AccountConnect } from '@/components/auth/AccountConnect';

describe('AccountConnect', () => {
  it('renders both Twitch and Kick platform cards', () => {
    render(<AccountConnect />);
    expect(screen.getByText('TwitchIcon')).toBeInTheDocument();
    expect(screen.getByText('KickIcon')).toBeInTheDocument();
  });

  it('shows connect buttons when not connected', () => {
    render(<AccountConnect />);
    // Expect at least 2 connect-like buttons for the 2 cards.
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(2);
  });
});
