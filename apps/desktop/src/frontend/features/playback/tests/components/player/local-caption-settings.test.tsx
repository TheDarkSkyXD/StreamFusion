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
  it("shows Coming soon and does not download a model mid-stream", () => {
    const { onTimedTextTrackChange, onDownload } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /Subtitles\/CC.*Off/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Local live captions (English)" }));
    expect(onTimedTextTrackChange).not.toHaveBeenCalled();
    expect(screen.getByText("Coming soon")).toBeVisible();
    expect(screen.getByText(/without a mid-stream model download/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Download local caption model" })).not.toBeInTheDocument();
    expect(onDownload).not.toHaveBeenCalled();
  });

  it("keeps Off selected when local live captions remain Coming soon", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: /Subtitles\/CC.*Off/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Local live captions (English)" }));
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
  });
});
