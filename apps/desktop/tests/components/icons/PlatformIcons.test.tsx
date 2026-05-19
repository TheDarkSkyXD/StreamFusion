import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  KickEmoteIcon,
  KickIcon,
  SevenTVIcon,
  TwitchIcon,
} from '@/components/icons/PlatformIcons';

describe('Platform Icons', () => {
  it('TwitchIcon renders an svg with default size 24', () => {
    const { container } = render(<TwitchIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });

  it('KickIcon honors custom size', () => {
    const { container } = render(<KickIcon size={36} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '36');
    expect(svg).toHaveAttribute('height', '36');
  });

  it('applies a custom className on the svg', () => {
    const { container } = render(<TwitchIcon className="text-purple-500" />);
    expect(container.querySelector('svg')).toHaveClass('text-purple-500');
  });

  it('SevenTVIcon renders an svg with default size 24', () => {
    const { container } = render(<SevenTVIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });

  it('SevenTVIcon honors custom size and className', () => {
    const { container } = render(
      <SevenTVIcon size={18} className="text-pink-400" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '18');
    expect(svg).toHaveAttribute('height', '18');
    expect(svg).toHaveClass('text-pink-400');
  });

  it('KickEmoteIcon renders an svg with default size 24', () => {
    const { container } = render(<KickEmoteIcon />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('height', '24');
  });

  it('KickEmoteIcon forwards size + className', () => {
    const { container } = render(
      <KickEmoteIcon size={20} className="text-green-400" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '20');
    expect(svg).toHaveClass('text-green-400');
  });
});
