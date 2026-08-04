import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerControls, type PlayerControlsProps } from "@/components/player/player-controls";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/components/player/play-pause-button", () => ({
  PlayPauseButton: () => (
    <button type="button" aria-label="Play or pause">
      Play
    </button>
  ),
}));

vi.mock("@/components/player/progress-bar", () => ({
  ProgressBar: () => null,
}));

vi.mock("@/components/player/settings-menu", () => ({
  SettingsMenu: () => null,
}));

vi.mock("@/components/player/volume-control", () => ({
  VolumeControl: () => null,
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: { preferences: undefined }) => unknown) =>
    selector({ preferences: undefined }),
}));

const defaultProps: PlayerControlsProps = {
  isPlaying: false,
  volume: 50,
  muted: false,
  qualities: [],
  currentQualityId: "auto",
  isFullscreen: false,
  onTogglePlay: vi.fn(),
  onVolumeChange: vi.fn(),
  onToggleMute: vi.fn(),
  onQualityChange: vi.fn(),
  onToggleFullscreen: vi.fn(),
  currentTime: 40,
  duration: 120,
  onSeek: vi.fn(),
};

function renderControls(props: Partial<PlayerControlsProps> = {}) {
  return render(
    <TooltipProvider>
      <PlayerControls {...defaultProps} {...props} />
    </TooltipProvider>
  );
}

// Guards: finite-media transport controls show independent seek intervals around play/pause.
// Guards: live and default callers without interval actions do not gain seek controls.
// Guards: each interval action can be disabled without suppressing the other direction.
describe("VOD seek controls", () => {
  it("shows independent rewind and fast-forward intervals flanking play/pause", () => {
    renderControls({
      seekBackwardSeconds: 7,
      seekForwardSeconds: 30,
      onSeekBackward: vi.fn(),
      onSeekForward: vi.fn(),
    });

    const rewind = screen.getByRole("button", { name: "Rewind 7 seconds" });
    const playPause = screen.getByRole("button", { name: "Play or pause" });
    const fastForward = screen.getByRole("button", { name: "Fast forward 30 seconds" });

    expect(within(rewind).getByText("7")).toBeVisible();
    expect(within(fastForward).getByText("30")).toBeVisible();
    expect(
      within(rewind.parentElement as HTMLElement)
        .getAllByRole("button")
        .slice(0, 3)
    ).toEqual([rewind, playPause, fastForward]);
  });

  it("omits interval controls when the caller supplies no seek actions", () => {
    renderControls();

    expect(screen.queryByRole("button", { name: /^Rewind / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Fast forward / })).not.toBeInTheDocument();
  });

  it("omits a seek direction when its action and finite interval are incomplete", () => {
    renderControls({
      onSeekBackward: vi.fn(),
      seekForwardSeconds: Number.POSITIVE_INFINITY,
      onSeekForward: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: /^Rewind / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Fast forward / })).not.toBeInTheDocument();
  });

  it("presents each seek direction's disabled state independently", () => {
    renderControls({
      seekBackwardSeconds: 7,
      seekForwardSeconds: 30,
      onSeekBackward: vi.fn(),
      onSeekForward: vi.fn(),
      seekBackwardDisabled: true,
    });

    const rewind = screen.getByRole("button", { name: "Rewind 7 seconds" });
    const fastForward = screen.getByRole("button", { name: "Fast forward 30 seconds" });
    expect(rewind).toBeDisabled();
    expect(fastForward).toBeEnabled();
  });
});
