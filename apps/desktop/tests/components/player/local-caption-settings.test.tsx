import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsMenu } from "@/components/player/settings-menu";
import { LOCAL_LIVE_CAPTION_TRACK } from "@/components/player/types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_USER_PREFERENCES } from "@/shared/auth-types";
import type { LocalCaptionModelState } from "@/shared/local-caption-types";
import { useAuthStore } from "@/store/auth-store";

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

// Guards: choosing uninstalled local captions stays Off until the user explicitly downloads the pinned pack.
// Guards: the inline disclosure names English coverage, exact size, license, and source instead of Unavailable.
describe("local caption settings", () => {
  it("discloses and starts the keyless model download without selecting local captions", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Subtitles\/CC.*Off/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Local live captions \(English\)" }));

    expect(onTimedTextTrackChange).not.toHaveBeenCalled();
    expect(screen.getByText(/English only/)).toBeVisible();
    expect(screen.getByText(/45,202,074 bytes \(43.11 MiB\)/)).toBeVisible();
    expect(screen.getByText(/Apache-2.0/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Hugging Face/ })).toHaveAttribute(
      "href",
      expect.stringContaining("sherpa-onnx-streaming-zipformer-en-20M")
    );

    fireEvent.click(screen.getByRole("button", { name: "Download local caption model" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("shows bounded download progress and lets the user cancel", () => {
    const onCancel = vi.fn();
    renderSettings(
      {
        phase: "downloading",
        downloadedBytes: 22_601_037,
      },
      { onLocalCaptionModelCancel: onCancel }
    );

    openCaptions();
    expect(screen.getByText("Downloading English model: 50%")).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Local caption model download" })
    ).toHaveAttribute("aria-valuenow", "50");
    fireEvent.click(screen.getByRole("button", { name: "Cancel download" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps captions Off after integrity failure and offers retry", () => {
    const onDownload = vi.fn();
    const onTrackChange = vi.fn();
    renderSettings(
      { phase: "integrity-error", error: "SHA-256 verification failed" },
      { onLocalCaptionModelDownload: onDownload, onTimedTextTrackChange: onTrackChange }
    );

    openCaptions();
    fireEvent.click(screen.getByRole("radio", { name: "Local live captions \(English\)" }));
    expect(screen.getByText("SHA-256 verification failed")).toBeVisible();
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Retry download" }));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onTrackChange).not.toHaveBeenCalled();
  });

  it("shows ready-offline and starting states and lets the user remove the model", () => {
    const onRemove = vi.fn();
    renderSettings(
      { phase: "ready", downloadedBytes: 45_202_074 },
      {
        currentTimedTextTrackKey: LOCAL_LIVE_CAPTION_TRACK.key,
        localCaptionPhase: "starting",
        onLocalCaptionModelRemove: onRemove,
      }
    );

    openCaptions();
    expect(screen.getByText("Starting local recognizer…")).toBeVisible();
    expect(screen.getByText(/Ready offline/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Remove model" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("surfaces a local recognizer failure and retries explicitly", () => {
    const onRetry = vi.fn();
    renderSettings(
      { phase: "ready", downloadedBytes: 45_202_074 },
      {
        localCaptionError: "Local caption recognizer stopped unexpectedly",
        onLocalCaptionRetry: onRetry,
      }
    );

    openCaptions();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Local caption recognizer stopped unexpectedly"
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry local captions" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

const baseModel: LocalCaptionModelState = {
  phase: "not-installed",
  languageLabel: "English",
  languageTag: "en",
  downloadBytes: 45_202_074,
  installedBytes: 45_202_074,
  displaySize: "43.11 MiB",
  license: "Apache-2.0",
  sourceName: "Hugging Face",
  sourceUrl: "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17",
};

function renderSettings(
  model: Partial<LocalCaptionModelState>,
  props: Partial<React.ComponentProps<typeof SettingsMenu>> = {}
) {
  return render(
    <TooltipProvider>
      <SettingsMenu
        qualities={[]}
        currentQualityId="auto"
        onQualityChange={vi.fn()}
        localTimedTextTrack={LOCAL_LIVE_CAPTION_TRACK}
        localCaptionModel={{ ...baseModel, ...model }}
        currentTimedTextTrackKey={null}
        {...props}
      />
    </TooltipProvider>
  );
}

function openCaptions() {
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: /Subtitles\/CC/ }));
}
