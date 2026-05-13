import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

describe('Tooltip', () => {
  it('shows tooltip content on focus of the trigger', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

    fireEvent.focus(screen.getByText('Hover me'));
    // Radix renders the tooltip in a portal; querying by text works.
    expect(screen.getAllByText('Tooltip text').length).toBeGreaterThan(0);
  });
});
