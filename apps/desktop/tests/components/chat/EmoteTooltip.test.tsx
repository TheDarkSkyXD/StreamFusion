import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmoteTooltip } from '@/components/chat/tooltips/EmoteTooltip';

const emote = {
  id: 'e1',
  name: 'KAPPA',
  provider: 'twitch' as const,
  isGlobal: false,
  isAnimated: true,
  isZeroWidth: false,
  urls: { url1x: 'a', url2x: 'b', url4x: 'c' },
};

describe('EmoteTooltip', () => {
  it('renders nothing when show is false', () => {
    render(<EmoteTooltip show={false} mousePos={{ x: 0, y: 0 }} emote={emote} />);
    expect(screen.queryByText('KAPPA')).not.toBeInTheDocument();
  });

  it('renders emote name, provider label, and GIF flag', () => {
    render(<EmoteTooltip show={true} mousePos={{ x: 100, y: 100 }} emote={emote} />);
    expect(screen.getByText('KAPPA')).toBeInTheDocument();
    expect(screen.getByText('Twitch')).toBeInTheDocument();
    expect(screen.getByText('GIF')).toBeInTheDocument();
  });

  it('shows ZW flag for zero-width emotes', () => {
    render(
      <EmoteTooltip
        show={true}
        mousePos={{ x: 0, y: 0 }}
        emote={{ ...emote, isZeroWidth: true, isAnimated: false }}
      />
    );
    expect(screen.getByText('ZW')).toBeInTheDocument();
  });
});
