import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PlayerControls } from '@/components/player/player-controls';
import { TwitchPlayerControls } from '@/components/player/twitch/twitch-player-controls';
import { TooltipProvider } from '@/components/ui/tooltip';

// Mock dependencies
vi.mock('@/components/player/play-pause-button', () => ({
    PlayPauseButton: ({ onToggle }: any) => <button onClick={onToggle}>Play/Pause</button>
}));

vi.mock('@/components/player/volume-control', () => ({
    VolumeControl: ({ onMuteToggle }: any) => <button onClick={onMuteToggle}>Volume</button>
}));

vi.mock('@/components/player/settings-menu', () => ({
    SettingsMenu: () => <div data-testid="settings-menu">Settings</div>
}));

vi.mock('@/components/player/progress-bar', () => ({
    ProgressBar: ({ onSeek }: any) => <div data-testid="progress-bar" onClick={() => onSeek(10)}>Progress</div>
}));

vi.mock('@/lib/utils', () => ({
    formatDuration: (s: number) => `${s}s`,
    cn: (...args: any[]) => args.join(' ')
}));

// Guards: blank player surfaces and unrelated controls cannot toggle playback; only explicit playback controls can.
// Guards: double-clicking the player surface still toggles fullscreen.
describe('PlayerControls', () => {
    const defaultProps = {
        isPlaying: false,
        volume: 100,
        muted: false,
        qualities: [],
        currentQualityId: 'auto',
        isFullscreen: false,
        onTogglePlay: vi.fn(),
        onVolumeChange: vi.fn(),
        onToggleMute: vi.fn(),
        onQualityChange: vi.fn(),
        onToggleFullscreen: vi.fn(),
        currentTime: 0,
        duration: 100,
        onSeek: vi.fn()
    };

    const renderControls = (props: any) => render(
        <TooltipProvider>
            <PlayerControls {...props} />
        </TooltipProvider>
    );

    it('should render controls', () => {
        renderControls(defaultProps);
        expect(screen.getByText('Play/Pause')).toBeInTheDocument();
        expect(screen.getByText('Volume')).toBeInTheDocument();
        expect(screen.getByTestId('settings-menu')).toBeInTheDocument();
        expect(screen.getByTestId('progress-bar')).toBeInTheDocument();
    });

    it('should handle play toggle', () => {
        renderControls(defaultProps);
        fireEvent.click(screen.getByText('Play/Pause'));
        expect(defaultProps.onTogglePlay).toHaveBeenCalled();
    });

    it('does not toggle playback when the blank player surface is clicked', () => {
        const onTogglePlay = vi.fn();
        const { container } = renderControls({ ...defaultProps, onTogglePlay });

        fireEvent.click(container.firstElementChild as HTMLElement);

        expect(onTogglePlay).not.toHaveBeenCalled();
    });

    it('does not toggle legacy Twitch playback when the blank player surface is clicked', () => {
        const onTogglePlay = vi.fn();
        const { container } = render(
            <TooltipProvider>
                <TwitchPlayerControls {...defaultProps} onTogglePlay={onTogglePlay} />
            </TooltipProvider>
        );

        fireEvent.click(container.firstElementChild as HTMLElement);

        expect(onTogglePlay).not.toHaveBeenCalled();
    });

    it('should render Live badge when duration is missing (Live stream)', () => {
        renderControls({ ...defaultProps, duration: undefined });
        expect(screen.getByText('Live')).toBeInTheDocument();
    });

    it('should render duration when VOD', () => {
        renderControls({ ...defaultProps, currentTime: 10, duration: 60 });
        // Mocks return "10s / 60s"
        expect(screen.getByText('10s / 60s')).toBeInTheDocument();
    });

    it('should handle double click to fullscreen', async () => {
        const onToggleFullscreen = vi.fn();
        const { container } = render(
            <TooltipProvider>
                <PlayerControls {...defaultProps} onToggleFullscreen={onToggleFullscreen} />
            </TooltipProvider>
        );

        const overlay = container.firstChild as HTMLElement;
        fireEvent.doubleClick(overlay);

        expect(onToggleFullscreen).toHaveBeenCalled();
    });
});
