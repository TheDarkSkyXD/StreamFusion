import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BadgeTooltip } from '@/components/chat/tooltips/BadgeTooltip';

describe('BadgeTooltip', () => {
  it('renders nothing when show is false', () => {
    render(
      <BadgeTooltip show={false} mousePos={{ x: 0, y: 0 }} badgeInfo={{ src: 'x', title: 'Mod' }} />
    );
    expect(screen.queryByText('Mod')).not.toBeInTheDocument();
  });

  it('renders the badge title when shown', () => {
    render(
      <BadgeTooltip
        show={true}
        mousePos={{ x: 100, y: 100 }}
        badgeInfo={{ src: 'https://x.test/b.png', title: 'Moderator', platform: 'Twitch' }}
      />
    );
    expect(screen.getByText('Moderator')).toBeInTheDocument();
    expect(screen.getByText('Twitch')).toBeInTheDocument();
  });

  it('renders nothing if badgeInfo is null', () => {
    render(<BadgeTooltip show={true} mousePos={{ x: 0, y: 0 }} badgeInfo={null} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
