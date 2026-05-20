import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FollowSource } from '@/shared/auth-types';

import { fixtures, renderWithProviders, screen } from '../../test-utils';

const toggleFollow = vi.fn();
const openExternal = vi.fn();
const toastFn = vi.fn();
let mockIsFollowing = false;
let mockFollowSource: FollowSource | null = null;

vi.mock('@/store/follow-store', () => ({
  useFollowStore: () => ({
    isFollowing: () => mockIsFollowing,
    toggleFollow,
    getFollowSource: () => (mockIsFollowing ? mockFollowSource : null),
  }),
}));

vi.mock('@/hooks/useElectron', () => ({
  useOpenExternal: () => openExternal,
}));

vi.mock('sonner', () => ({
  toast: (...args: unknown[]) => toastFn(...args),
}));

import { FollowButton } from '@/components/ui/follow-button';

describe('FollowButton', () => {
  beforeEach(() => {
    toggleFollow.mockReset();
    openExternal.mockReset();
    toastFn.mockReset();
    mockIsFollowing = false;
    mockFollowSource = null;
  });

  it('renders "Follow" label when not following', () => {
    renderWithProviders(<FollowButton channel={fixtures.channel({ platform: 'twitch' })} />);
    expect(screen.getByText('Follow')).toBeInTheDocument();
  });

  it('calls toggleFollow when clicked and stops event propagation', () => {
    const onParentClick = vi.fn();
    renderWithProviders(
      // biome-ignore lint/a11y/useKeyWithClickEvents: test
      <div onClick={onParentClick}>
        <FollowButton channel={fixtures.channel({ platform: 'kick' })} />
      </div>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(toggleFollow).toHaveBeenCalled();
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('renders icon-only when already following', () => {
    mockIsFollowing = true;
    mockFollowSource = 'guest';
    renderWithProviders(<FollowButton channel={fixtures.channel({ platform: 'twitch' })} />);
    expect(screen.queryByText('Follow')).not.toBeInTheDocument();
  });

  it('toggles locally on a guest-source row', () => {
    mockIsFollowing = true;
    mockFollowSource = 'guest';
    renderWithProviders(<FollowButton channel={fixtures.channel({ platform: 'twitch' })} />);
    fireEvent.click(screen.getByRole('button'));
    expect(toggleFollow).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
    expect(toastFn).not.toHaveBeenCalled();
  });

  it('routes account-source Twitch row to twitch.tv (no local toggle)', () => {
    mockIsFollowing = true;
    mockFollowSource = 'account';
    renderWithProviders(
      <FollowButton channel={fixtures.channel({ platform: 'twitch', username: 'xQc' })} />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(toggleFollow).not.toHaveBeenCalled();
    expect(toastFn).toHaveBeenCalledTimes(1);
    const [message, opts] = toastFn.mock.calls[0] as [string, { action: { onClick: () => void } }];
    expect(message).toMatch(/twitch/i);
    // Simulate the user clicking the "Open Twitch" action button in the toast.
    opts.action.onClick();
    expect(openExternal).toHaveBeenCalledWith('https://www.twitch.tv/xqc');
  });

  it('still toggles locally on an account-source Kick row (Twitch-only carve-out)', () => {
    mockIsFollowing = true;
    mockFollowSource = 'account';
    renderWithProviders(<FollowButton channel={fixtures.channel({ platform: 'kick' })} />);
    fireEvent.click(screen.getByRole('button'));
    expect(toggleFollow).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
  });
});
