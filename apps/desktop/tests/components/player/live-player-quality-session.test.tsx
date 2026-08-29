import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KickLivePlayer } from "@/features/playback/components/player/kick/kick-live-player";
import {
  PersistentPlayerShell,
  useRegisterDockedPlayerConfig,
} from "@/features/playback/components/player/persistent-player-shell";
import type { QualityLevel } from "@/features/playback/components/player/types";

const harness = vi.hoisted(() => ({
  hlsProps: null as null | {
    onActiveQualityChange?: (qualityId: string) => void;
    onHlsInstance?: (hls: unknown) => void;
    onQualityLevels?: (levels: QualityLevel[]) => void;
    preferredQuality?: string;
  },
  controlProps: null as null | {
    currentQualityId: string;
    onQualityChange: (qualityId: string) => void;
  },
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ preferences: { playback: { defaultQuality: "highest" } } }),
}));
vi.mock("@/components/dev/use-render-count", () => ({ useRenderCount: vi.fn() }));
vi.mock("@/components/ui/loading-spinner", () => ({ KickLoadingSpinner: () => null }));
vi.mock("@/features/playback/components/player/caption-overlay", () => ({ CaptionOverlay: () => null }));
vi.mock("@/features/playback/components/player/hooks/use-fullscreen", () => ({
  useFullscreen: () => ({ isFullscreen: false, toggleFullscreen: vi.fn() }),
}));
vi.mock("@/features/playback/components/player/hooks/use-picture-in-picture", () => ({
  usePictureInPicture: () => ({ isPip: false, togglePip: vi.fn() }),
}));
vi.mock("@/features/playback/components/player/hooks/use-player-keyboard", () => ({ usePlayerKeyboard: vi.fn() }));
vi.mock("@/features/playback/components/player/hooks/use-player-network-recovery", () => ({
  usePlayerNetworkRecovery: vi.fn(),
}));
vi.mock("@/features/playback/components/player/hooks/use-resume-playback", () => ({ useResumePlayback: vi.fn() }));
vi.mock("@/features/playback/components/player/hooks/use-timed-text", () => ({
  useTimedText: () => ({
    activeCues: [],
    selectedTrackKey: null,
    selectTrack: vi.fn(),
    tracks: [],
  }),
}));
vi.mock("@/features/playback/components/player/hooks/use-local-live-captions", () => ({
  useLocalLiveCaptions: () => ({ activeCues: [], selected: false, stop: vi.fn() }),
}));
vi.mock("@/features/playback/components/player/hooks/use-volume", () => ({
  useVolume: () => ({
    volume: 50,
    isMuted: false,
    handleVolumeChange: vi.fn(),
    handleToggleMute: vi.fn(),
    syncFromVideoElement: vi.fn(),
  }),
}));
vi.mock("@/features/playback/components/player/kick/uptime-readout", () => ({ UptimeReadout: () => null }));
vi.mock("@/features/playback/components/player/kick/kick-live-player-controls", () => ({
  KickLivePlayerControls: (props: typeof harness.controlProps) => {
    harness.controlProps = props;
    return null;
  },
}));
vi.mock("@/features/playback/components/player/kick/kick-hls-player", async () => {
  const { forwardRef } = await import("react");
  return {
    KickHlsPlayer: forwardRef<HTMLVideoElement, NonNullable<typeof harness.hlsProps>>(
      (props, ref) => {
        harness.hlsProps = props;
        return <video ref={ref} />;
      }
    ),
  };
});

const LEVELS: QualityLevel[] = [
  { id: "auto", label: "Auto", width: 0, height: 0, bitrate: 0, isAuto: true },
  { id: "0", label: "720p60", width: 1280, height: 720, bitrate: 3_000_000 },
  {
    id: "1",
    label: "1080p60 (Source)",
    width: 1920,
    height: 1080,
    bitrate: 6_000_000,
    isSource: true,
  },
];

function DockRegistration({ active }: { active: boolean }) {
  const register = useRegisterDockedPlayerConfig();
  useEffect(() => {
    if (!active || !register) return;
    return register({
      muted: false,
      isTheater: false,
      onError: vi.fn(),
      onRefresh: vi.fn(),
      onToggleTheater: vi.fn(),
    });
  }, [active, register]);
  return null;
}

function Session({ docked }: { docked: boolean }) {
  return (
    <PersistentPlayerShell>
      <DockRegistration active={docked} />
      <KickLivePlayer
        streamUrl="https://kick.test/live.m3u8"
        channelName="quality-channel"
        compact={!docked}
      />
    </PersistentPlayerShell>
  );
}

// Guards: only a docked channel-page session seeds saved quality; mini and return transitions preserve its observed level without reselecting.
// Guards: controls report only LEVEL_SWITCHED observations, never an optimistic saved or manual preference.
// Guards: manual fixed quality survives reordered manifests as a semantic ceiling instead of a numeric HLS index.
describe("live player quality session", () => {
  beforeEach(() => {
    harness.hlsProps = null;
    harness.controlProps = null;
  });

  it("does not seed saved quality outside the channel-page dock", () => {
    render(
      <KickLivePlayer
        streamUrl="https://kick.test/multistream.m3u8"
        channelName="multistream-channel"
      />
    );

    expect(harness.hlsProps?.preferredQuality).toBeUndefined();
  });

  it("preserves the main session through mini and return without an optimistic level reset", async () => {
    const { rerender } = render(<Session docked />);
    await waitFor(() => expect(harness.hlsProps?.preferredQuality).toBe("highest"));

    act(() => harness.hlsProps?.onQualityLevels?.(LEVELS));
    expect(harness.controlProps?.currentQualityId).toBe("auto");
    act(() => harness.hlsProps?.onActiveQualityChange?.("1"));
    expect(harness.controlProps?.currentQualityId).toBe("1");

    rerender(<Session docked={false} />);
    await waitFor(() => expect(harness.hlsProps?.preferredQuality).toBeUndefined());
    rerender(<Session docked />);
    await waitFor(() => expect(harness.hlsProps?.preferredQuality).toBe("highest"));
    expect(harness.controlProps?.currentQualityId).toBe("1");
  });

  it("keeps manual selection semantic and waits for the actual switched level", async () => {
    render(<Session docked />);
    await waitFor(() => expect(harness.hlsProps?.preferredQuality).toBe("highest"));
    const hls = { currentLevel: -1, levels: [{}, {}] };
    act(() => harness.hlsProps?.onHlsInstance?.(hls));
    act(() => harness.hlsProps?.onQualityLevels?.(LEVELS));
    act(() => harness.controlProps?.onQualityChange("0"));

    expect(harness.hlsProps?.preferredQuality).toBe("720p");
    expect(hls.currentLevel).toBe(0);
    expect(harness.controlProps?.currentQualityId).toBe("auto");

    act(() => harness.hlsProps?.onActiveQualityChange?.("1"));
    expect(harness.controlProps?.currentQualityId).toBe("1");
    act(() =>
      harness.hlsProps?.onQualityLevels?.([
        LEVELS[0],
        { ...LEVELS[2], id: "0" },
        { ...LEVELS[1], id: "1" },
      ])
    );
    expect(harness.hlsProps?.preferredQuality).toBe("720p");
    expect(harness.controlProps?.currentQualityId).toBe("auto");
  });
});
