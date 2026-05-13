import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KickIcon, TwitchIcon } from '@/components/icons/PlatformIcons';

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
});
