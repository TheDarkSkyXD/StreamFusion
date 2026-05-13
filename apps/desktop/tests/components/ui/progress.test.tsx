import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Progress } from '@/components/ui/progress';

describe('Progress', () => {
  it('renders an indicator translated by 100 - value', () => {
    const { container } = render(<Progress value={42} />);
    const indicator = container.querySelector('[style*="translateX"]') as HTMLElement | null;
    expect(indicator).not.toBeNull();
    expect(indicator?.style.transform).toContain('translateX(-58%)');
  });

  it('defaults to 0 when value is undefined', () => {
    const { container } = render(<Progress />);
    const indicator = container.querySelector('[style*="translateX"]') as HTMLElement | null;
    expect(indicator?.style.transform).toContain('translateX(-100%)');
  });

  it('applies a custom className on the root', () => {
    const { container } = render(<Progress value={50} className="custom" />);
    expect(container.firstChild).toHaveClass('custom');
  });
});
