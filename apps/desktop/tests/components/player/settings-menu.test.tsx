import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { SettingsMenu } from '@/components/player/settings-menu';
import type { QualityLevel } from '@/components/player/types';

const qualities: QualityLevel[] = [
  { id: 'auto', label: 'Auto', bitrate: 0, isAuto: true },
  { id: '1080p', label: '1080p', bitrate: 6_000_000 },
] as QualityLevel[];

describe('SettingsMenu', () => {
  it('renders the gear trigger button', () => {
    render(
      <TooltipProvider>
        <SettingsMenu qualities={qualities} currentQualityId="auto" onQualityChange={vi.fn()} />
      </TooltipProvider>
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('opens the menu on click', () => {
    render(
      <TooltipProvider>
        <SettingsMenu qualities={qualities} currentQualityId="auto" onQualityChange={vi.fn()} />
      </TooltipProvider>
    );
    fireEvent.click(screen.getByRole('button'));
    // Once open, "Quality" or playback speed labels should appear somewhere.
    expect(screen.queryAllByText(/quality|speed/i).length).toBeGreaterThan(0);
  });
});
