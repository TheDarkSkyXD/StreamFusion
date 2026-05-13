import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtures, renderWithProviders, screen } from '../../test-utils';

const toggleFollow = vi.fn();
let mockIsFollowing = false;

vi.mock('@/store/follow-store', () => ({
  useFollowStore: () => ({
    isFollowing: () => mockIsFollowing,
    toggleFollow,
  }),
}));

import { FollowButton } from '@/components/ui/follow-button';

describe('FollowButton', () => {
  beforeEach(() => {
    toggleFollow.mockReset();
    mockIsFollowing = false;
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
    renderWithProviders(<FollowButton channel={fixtures.channel({ platform: 'twitch' })} />);
    expect(screen.queryByText('Follow')).not.toBeInTheDocument();
  });
});
