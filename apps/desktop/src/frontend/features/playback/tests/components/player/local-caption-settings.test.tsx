import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsMenu } from "@/features/playback/components/player/settings-menu";
import { LOCAL_LIVE_CAPTION_TRACK } from "@/features/playback/capabilities/media-types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";
import { useAuthStore } from "@/features/auth/components/state/auth-store";

const originalUpdatePreferences = useAuthStore.getState().updatePreferences;

beforeEach(() => {
  useAuthStore.setState({
    preferences: { ...DEFAULT_USER_PREFERENCES },
    updatePreferences: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  useAuthStore.setState({ preferences: null, updatePreferences: originalUpdatePreferences });
});

function renderMenu() {
  const onTimedTextTrackChange = vi.fn();
  const onDownload = vi.fn();
  render(
    <TooltipProvider>
      <SettingsMenu
        qualities={[]}
        currentQualityId="auto"
        onQualityChange={vi.fn()}
        timedTextTracks={[
          {
            key: "subtitles:en",
            hlsTrackId: 0,
            cueTrack: "subtitles0",
            kind: "subtitles",
            label: "English",
            language: "en",
          },
        ]}
        localTimedTextTrack={LOCAL_LIVE_CAPTION_TRACK}
        localCaptionModel={{
          phase: "not-installed",
          languageLabel: "English",
          languageTag: "en",
          downloadBytes: 45_202_074,
          installedBytes: 45_202_074,
          displaySize: "43.11 MiB",
          license: "Apache-2.0",
          sourceName: "Hugging Face",
          sourceUrl:
            "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17",
        }}
        currentTimedTextTrackKey={null}
        onTimedTextTrackChange={onTimedTextTrackChange}
        onLocalCaptionModelDownload={onDownload}
      />
    </TooltipProvider>
  );
  return { onTimedTextTrackChange, onDownload };
}

describe("local caption settings", () => {
  it("hides Subtitles/CC player chrome even when tracks or local captions exist", () => {
    const { onDownload } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByRole("button", { name: /Subtitles\/CC/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("local-captions-coming-soon")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download local caption model" })).not.toBeInTheDocument();
    expect(onDownload).not.toHaveBeenCalled();
  });
});
