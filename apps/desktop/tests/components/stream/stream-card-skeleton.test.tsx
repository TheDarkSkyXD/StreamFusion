import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StreamCardSkeleton } from '@/components/stream/stream-card-skeleton';

describe('StreamCardSkeleton', () => {
  it('renders an animate-pulse skeleton card', () => {
    const { container } = render(<StreamCardSkeleton />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });
});
