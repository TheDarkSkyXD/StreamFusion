import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

let mockIsGuest = false;

vi.mock('@/store/auth-store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ isGuest: mockIsGuest }),
}));

import { GuestBadge } from '@/components/auth/GuestMode';

describe('GuestBadge', () => {
  it('renders nothing when not a guest', () => {
    mockIsGuest = false;
    const { container } = render(<GuestBadge />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Guest" text when isGuest is true', () => {
    mockIsGuest = true;
    render(<GuestBadge />);
    expect(screen.getByText('Guest')).toBeInTheDocument();
  });

  it('honors size prop', () => {
    mockIsGuest = true;
    render(<GuestBadge size="lg" />);
    const badge = screen.getByText('Guest');
    expect(badge.className).toMatch(/text-base/);
  });
});
