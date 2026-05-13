import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EmoteImage } from '@/components/chat/EmoteImage';

const emote = {
  id: 'e1',
  name: 'Kappa',
  provider: 'twitch' as const,
  isGlobal: false,
  isAnimated: false,
  isZeroWidth: false,
  urls: {
    url1x: 'https://x.test/1x.png',
    url2x: 'https://x.test/2x.png',
    url4x: 'https://x.test/4x.png',
  },
};

describe('EmoteImage', () => {
  it('renders the emote with name as alt', () => {
    render(<EmoteImage emote={emote} />);
    expect(screen.getByAltText('Kappa')).toBeInTheDocument();
  });

  it('selects the URL appropriate to the size', () => {
    render(<EmoteImage emote={emote} size="xlarge" />);
    expect(screen.getByAltText('Kappa')).toHaveAttribute('src', 'https://x.test/4x.png');
  });

  it('fires onClick when provided', () => {
    const onClick = vi.fn();
    render(<EmoteImage emote={emote} onClick={onClick} />);
    fireEvent.click(screen.getByAltText('Kappa'));
    expect(onClick).toHaveBeenCalledWith(emote);
  });

  it('shows a name fallback if the image errors', () => {
    render(<EmoteImage emote={emote} />);
    fireEvent.error(screen.getByAltText('Kappa'));
    expect(screen.getByText('Kappa')).toBeInTheDocument();
  });
});
