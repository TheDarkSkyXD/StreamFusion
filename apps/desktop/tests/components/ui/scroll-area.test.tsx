import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ScrollArea } from '@/components/ui/scroll-area';

describe('ScrollArea', () => {
  it('renders children inside the scroll container', () => {
    render(
      <ScrollArea className="h-32 w-32">
        <div>scrollable content</div>
      </ScrollArea>
    );
    expect(screen.getByText('scrollable content')).toBeInTheDocument();
  });
});
