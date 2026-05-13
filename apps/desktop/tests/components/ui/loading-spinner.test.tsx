import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  KickLoadingSpinner,
  LoadingSpinner,
  TwitchLoadingSpinner,
} from '@/components/ui/loading-spinner';

describe('LoadingSpinner', () => {
  it('renders a spinning element with default lg size', () => {
    const { container } = render(<LoadingSpinner />);
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass('animate-spin');
    expect(el.style.width).toBe('48px');
  });

  it('applies the small size when size="sm"', () => {
    const { container } = render(<LoadingSpinner size="sm" />);
    expect((container.firstChild as HTMLElement).style.width).toBe('24px');
  });

  it('uses the passed color as borderTopColor', () => {
    const { container } = render(<LoadingSpinner color="#abcdef" />);
    expect((container.firstChild as HTMLElement).style.borderTopColor).toBe('rgb(171, 205, 239)');
  });

  it('TwitchLoadingSpinner uses purple', () => {
    const { container } = render(<TwitchLoadingSpinner />);
    expect((container.firstChild as HTMLElement).style.borderTopColor).toBe('rgb(145, 70, 255)');
  });

  it('KickLoadingSpinner uses green', () => {
    const { container } = render(<KickLoadingSpinner />);
    expect((container.firstChild as HTMLElement).style.borderTopColor).toBe('rgb(83, 252, 24)');
  });
});
