import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlayPauseButton } from '@/components/player/play-pause-button';
import { VolumeControl } from '@/components/player/volume-control';
import { QualitySelector } from '@/components/player/quality-selector';
import { QualityLevel } from '@/components/player/types';
import { TooltipProvider } from '@/components/ui/tooltip';

// Icons come from `react-icons/lu`, which renders raw SVG without a
// `.lucide-*` class. We differentiate icons by inner SVG element type:
//   LuPlay   → 1 <polygon>
//   LuPause  → 2 <rect>
//   LuVolume2 → 3 <path>, 0 <line>
//   LuVolumeX → 1 <path>, 2 <line>
describe('Player Controls', () => {
    describe('PlayPauseButton', () => {
        it('should render play icon when paused', () => {
            const { container } = render(
                <TooltipProvider>
                    <PlayPauseButton isPlaying={false} onToggle={vi.fn()} />
                </TooltipProvider>
            );
            expect(container.querySelector('svg polygon')).toBeInTheDocument();
        });

        it('should render pause icon when playing', () => {
            const { container } = render(
                <TooltipProvider>
                    <PlayPauseButton isPlaying={true} onToggle={vi.fn()} />
                </TooltipProvider>
            );
            expect(container.querySelectorAll('svg rect').length).toBe(2);
        });

        it('should call onToggle when clicked', () => {
            const onToggle = vi.fn();
            render(
                <TooltipProvider>
                    <PlayPauseButton isPlaying={false} onToggle={onToggle} />
                </TooltipProvider>
            );
            fireEvent.click(screen.getByRole('button'));
            expect(onToggle).toHaveBeenCalled();
        });
    });

    describe('VolumeControl', () => {
        it('should render volume level correctly (high)', () => {
            const { container } = render(
                <TooltipProvider>
                    <VolumeControl volume={80} muted={false} onVolumeChange={vi.fn()} onMuteToggle={vi.fn()} />
                </TooltipProvider>
            );
            // Volume2 has no <line> elements (VolumeX has 2).
            expect(container.querySelectorAll('svg line').length).toBe(0);
            expect(container.querySelector('svg path')).toBeInTheDocument();
        });

        it('should render muted state', () => {
            const { container } = render(
                <TooltipProvider>
                    <VolumeControl volume={80} muted={true} onVolumeChange={vi.fn()} onMuteToggle={vi.fn()} />
                </TooltipProvider>
            );
            // VolumeX has the two crossed <line>s on top of the speaker path.
            expect(container.querySelectorAll('svg line').length).toBe(2);
        });

        it('should call onMuteToggle when button clicked', () => {
            const onMuteToggle = vi.fn();
            render(
                <TooltipProvider>
                    <VolumeControl volume={50} muted={false} onVolumeChange={vi.fn()} onMuteToggle={onMuteToggle} />
                </TooltipProvider>
            );
            fireEvent.click(screen.getByRole('button'));
            expect(onMuteToggle).toHaveBeenCalled();
        });
    });

    describe('QualitySelector', () => {
        const qualities: QualityLevel[] = [
            { id: 'auto', label: 'Auto', bitrate: 0, isAuto: true },
            { id: '1080p', label: '1080p', bitrate: 6000000 }
        ] as any; // Cast to any to avoid strict type checking for width/height if redundant for this test

        it('should not render if no levels', () => {
            const { container } = render(<QualitySelector levels={[]} current="auto" onChange={vi.fn()} />);
            expect(container).toBeEmptyDOMElement();
        });

        it('should render selected value', () => {
            render(<QualitySelector levels={qualities} current="auto" onChange={vi.fn()} />);
            expect(screen.getByText('Auto')).toBeInTheDocument();
        });
    });
});
