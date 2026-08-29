import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlayerControls } from '@/features/playback/components/player/player-controls';
import { SettingsMenu } from '@/features/playback/components/player/settings-menu';
import type { QualityLevel } from '@/features/playback/components/player/types';
import { VolumeControl } from '@/features/playback/components/player/volume-control';
import {
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  type PlayerControlsPreferences,
} from '@shared/auth-types';
import { useAuthStore } from '@/store/auth-store';
import { TooltipProvider } from '@/components/ui/tooltip';

// Drive each control's visibility by seeding playerControls in the auth store.
// Mirrors the Username/PredictionBanner preferences-merge idiom (real store, no mock).
function setPlayerControls(overrides: Partial<PlayerControlsPreferences>) {
  useAuthStore.setState((s) => ({
    ...s,
    preferences: {
      ...(s.preferences ?? {}),
      playerControls: { ...DEFAULT_PLAYER_CONTROLS_PREFERENCES, ...overrides },
    } as typeof s.preferences,
  }));
}

beforeEach(() => {
  // Reset to all-visible defaults before each render so prior overrides don't leak.
  setPlayerControls({});
});

afterEach(() => {
  vi.clearAllMocks();
});

const qualities: QualityLevel[] = [
  { id: 'auto', label: 'Auto', bitrate: 0, isAuto: true },
  { id: '1080p', label: '1080p', bitrate: 6_000_000 },
] as QualityLevel[];

function renderSettingsMenu(extra: Record<string, unknown> = {}) {
  return render(
    <TooltipProvider>
      <SettingsMenu
        qualities={qualities}
        currentQualityId="auto"
        onQualityChange={vi.fn()}
        onPlaybackRateChange={vi.fn()}
        onToggleVideoStats={vi.fn()}
        {...extra}
      />
    </TooltipProvider>
  );
}

function openMenu() {
  // The gear trigger is the first button in the SettingsMenu.
  fireEvent.click(screen.getAllByRole('button')[0]);
}

describe('SettingsMenu control visibility (U8)', () => {
  it('shows Quality / Playback speed / Video Stats when all flags are on', () => {
    renderSettingsMenu();
    openMenu();
    expect(screen.getByText('Quality')).toBeInTheDocument();
    expect(screen.getByText('Playback speed')).toBeInTheDocument();
    expect(screen.getByText('Video Stats')).toBeInTheDocument();
  });

  it('hides the Quality menu item when showQuality is off', () => {
    setPlayerControls({ showQuality: false });
    renderSettingsMenu();
    openMenu();
    expect(screen.queryByText('Quality')).not.toBeInTheDocument();
    // Other items remain.
    expect(screen.getByText('Playback speed')).toBeInTheDocument();
  });

  it('hides the Playback speed menu item when showPlaybackSpeed is off', () => {
    setPlayerControls({ showPlaybackSpeed: false });
    renderSettingsMenu();
    openMenu();
    expect(screen.queryByText('Playback speed')).not.toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  it('hides the Video Stats menu item when showVideoStats is off', () => {
    setPlayerControls({ showVideoStats: false });
    renderSettingsMenu();
    openMenu();
    expect(screen.queryByText('Video Stats')).not.toBeInTheDocument();
    expect(screen.getByText('Quality')).toBeInTheDocument();
  });

  it('keeps Playback speed naturally absent on live regardless of the flag', () => {
    // Live surfaces omit onPlaybackRateChange; the item must not appear even when
    // showPlaybackSpeed is true (a naturally-absent control is not force-rendered).
    setPlayerControls({ showPlaybackSpeed: true });
    renderSettingsMenu({ onPlaybackRateChange: undefined });
    openMenu();
    expect(screen.queryByText('Playback speed')).not.toBeInTheDocument();
  });

  it('opens with no crash when every settings-menu control is hidden', () => {
    setPlayerControls({
      showQuality: false,
      showPlaybackSpeed: false,
      showVideoStats: false,
    });
    renderSettingsMenu();
    openMenu();
    expect(screen.queryByText('Quality')).not.toBeInTheDocument();
    expect(screen.queryByText('Playback speed')).not.toBeInTheDocument();
    expect(screen.queryByText('Video Stats')).not.toBeInTheDocument();
  });
});

describe('VolumeControl visibility (U8)', () => {
  it('renders the volume button when showVolume is on', () => {
    const { container } = render(
      <TooltipProvider>
        <VolumeControl volume={80} muted={false} onVolumeChange={vi.fn()} onMuteToggle={vi.fn()} />
      </TooltipProvider>
    );
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('renders nothing when showVolume is off, without touching audio state (R15)', () => {
    setPlayerControls({ showVolume: false });
    const onVolumeChange = vi.fn();
    const onMuteToggle = vi.fn();
    const { container } = render(
      <TooltipProvider>
        <VolumeControl
          volume={80}
          muted={false}
          onVolumeChange={onVolumeChange}
          onMuteToggle={onMuteToggle}
        />
      </TooltipProvider>
    );
    // Chrome gone...
    expect(container.querySelector('button')).toBeNull();
    // ...but hiding the control must NOT mute or change volume.
    expect(onMuteToggle).not.toHaveBeenCalled();
    expect(onVolumeChange).not.toHaveBeenCalled();
  });
});

describe('PlayerControls Theater / Fullscreen visibility (U8)', () => {
  const baseProps = {
    isPlaying: false,
    volume: 80,
    muted: false,
    qualities,
    currentQualityId: 'auto',
    isFullscreen: false,
    onTogglePlay: vi.fn(),
    onVolumeChange: vi.fn(),
    onToggleMute: vi.fn(),
    onQualityChange: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onToggleTheater: vi.fn(),
    currentTime: 0,
    duration: 100,
    onSeek: vi.fn(),
  };

  // Icon-only buttons get their label from a Radix tooltip that only mounts on
  // hover, so accessible-name queries are flaky in jsdom. Identify these two by
  // their distinctive SVG signatures instead:
  //  - Fullscreen (LuMaximize/LuMinimize) is the only control icon with strokeWidth 3.
  //  - Theater (custom outline/filled icon) is the only SVG containing <line x1="15">.
  const findFullscreenButton = (root: HTMLElement) =>
    root.querySelector('svg[stroke-width="3"]')?.closest('button') ?? null;
  const findTheaterButton = (root: HTMLElement) =>
    root.querySelector('svg line[x1="15"]')?.closest('button') ?? null;

  const renderControls = (props: Record<string, unknown> = {}) =>
    render(
      <TooltipProvider>
        <PlayerControls {...baseProps} {...props} />
      </TooltipProvider>
    );

  it('shows Fullscreen and Theater buttons when both flags are on', () => {
    const { container } = renderControls();
    expect(findFullscreenButton(container)).not.toBeNull();
    expect(findTheaterButton(container)).not.toBeNull();
  });

  it('hides the Fullscreen button when showFullscreen is off', () => {
    setPlayerControls({ showFullscreen: false });
    const { container } = renderControls();
    expect(findFullscreenButton(container)).toBeNull();
    // Theater stays.
    expect(findTheaterButton(container)).not.toBeNull();
  });

  it('hides the Theater button when showTheater is off', () => {
    setPlayerControls({ showTheater: false });
    const { container } = renderControls();
    expect(findTheaterButton(container)).toBeNull();
    expect(findFullscreenButton(container)).not.toBeNull();
  });

  it('does not crash and does not toggle fullscreen when all flags are hidden', () => {
    setPlayerControls({
      showVolume: false,
      showFullscreen: false,
      showTheater: false,
      showQuality: false,
      showPlaybackSpeed: false,
      showVideoStats: false,
    });
    const { container } = renderControls();
    expect(findFullscreenButton(container)).toBeNull();
    expect(findTheaterButton(container)).toBeNull();
    // Hiding chrome must not fire any playback/view handler.
    expect(baseProps.onToggleFullscreen).not.toHaveBeenCalled();
    expect(baseProps.onToggleTheater).not.toHaveBeenCalled();
    expect(baseProps.onToggleMute).not.toHaveBeenCalled();
  });
});
