import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProgressBar } from '@/features/playback/components/player/progress-bar';

describe('ProgressBar', () => {
    it('should result in 0 width when duration is 0', () => {
        const { container } = render(
            <ProgressBar currentTime={0} duration={0} onSeek={vi.fn()} />
        );
        const progressEl = container.querySelector('.bg-white'); // The progress thumb/bar logic
        // The implementation uses inline style width.
        // We can find the element with style width.
        // There's a div with ${color} (default bg-white) and style width.
        const progressBar = container.querySelector('.absolute.top-0.bottom-0.left-0.h-full.bg-white');
        expect(progressBar).toHaveStyle({ width: '0%' });
    });

    it('should calculate width correctly', () => {
        const { container } = render(
            <ProgressBar currentTime={50} duration={100} onSeek={vi.fn()} />
        );
        const progressBar = container.querySelector('.absolute.top-0.bottom-0.left-0.h-full.bg-white');
        expect(progressBar).toHaveStyle({ width: '50%' });
    });

    it('should call onSeek with correct time on click', () => {
        const onSeek = vi.fn();
        const { container } = render(
            <ProgressBar currentTime={50} duration={100} onSeek={onSeek} />
        );

        // Mock getBoundingClientRect
        const progressDiv = container.firstChild as HTMLDivElement;
        vi.spyOn(progressDiv, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            width: 100,
            top: 0,
            height: 20,
            right: 100,
            bottom: 20,
            x: 0,
            y: 0,
            toJSON: () => { }
        });

        // Click at 75% mark (client X = 75)
        fireEvent.click(progressDiv, { clientX: 75 });

        // Should seek to 75 (75% of 100 duration)
        expect(onSeek).toHaveBeenCalledWith(75);
    });

    it('should call onSeekHover on mouse move', () => {
        const onSeekHover = vi.fn();
        const { container } = render(
            <ProgressBar currentTime={50} duration={100} onSeek={vi.fn()} onSeekHover={onSeekHover} />
        );

        const progressDiv = container.firstChild as HTMLDivElement;
        vi.spyOn(progressDiv, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            width: 100,
            top: 0,
            height: 20,
            right: 100,
            bottom: 20,
            x: 0,
            y: 0,
            toJSON: () => { }
        });

        fireEvent.mouseEnter(progressDiv);
        fireEvent.mouseMove(progressDiv, { clientX: 25 });

        expect(onSeekHover).toHaveBeenCalledWith(25);
    });
});
