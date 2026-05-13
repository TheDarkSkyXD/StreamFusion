import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CategoryCardSkeleton } from '@/components/discovery/category-card-skeleton';

describe('CategoryCardSkeleton', () => {
  it('renders an animate-pulse skeleton card', () => {
    const { container } = render(<CategoryCardSkeleton />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
