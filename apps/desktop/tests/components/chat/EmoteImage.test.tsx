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

// Guards: loading state hides the emote behind a pulsing placeholder and reveals it only after onLoad — prevents zero-width emote flash before the CDN responds
// Guards: error state (CDN 404 / blocked) renders the emote name as text fallback so the message stays readable even when 7TV/BTTV serves a 404
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

  it('error: shows the emote name as text fallback when the CDN serves a 404 / blocked image', () => {
    render(<EmoteImage emote={emote} />);
    fireEvent.error(screen.getByAltText('Kappa'));
    expect(screen.getByText('Kappa')).toBeInTheDocument();
  });

  it('loading: keeps the loading placeholder (animate-pulse) on screen until onLoad fires', () => {
    const { container } = render(<EmoteImage emote={emote} />);
    // The placeholder span is rendered with animate-pulse until the image's
    // onLoad fires. We never fire it here, so the placeholder stays.
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
