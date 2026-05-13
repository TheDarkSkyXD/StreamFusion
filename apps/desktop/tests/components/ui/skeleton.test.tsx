import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from '@/components/ui/skeleton';

describe('Skeleton', () => {
  it('renders with animate-pulse and rounded-md classes', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass('animate-pulse');
    expect(container.firstChild).toHaveClass('rounded-md');
  });

  it('merges custom className', () => {
    const { container } = render(<Skeleton className="custom-thing" />);
    expect(container.firstChild).toHaveClass('custom-thing');
    expect(container.firstChild).toHaveClass('animate-pulse');
  });
});
