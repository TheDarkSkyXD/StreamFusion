import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { chooseDownloadSavePath } from "@backend/services/download-save-dialog";

// Guards: clip and VOD save dialogs share the most recently selected download folder
// Guards: canceling a save dialog does not replace the remembered download folder
describe("download save dialog", () => {
  it("uses the selected clip folder for the next VOD save dialog", async () => {
    const fallbackDirectory = path.resolve("fallback-downloads");
    const selectedDirectory = path.resolve("selected-media");
    let rememberedDirectory: string | null = null;
    const showSaveDialog = vi
      .fn()
      .mockResolvedValueOnce({
        canceled: false,
        filePath: path.join(selectedDirectory, "clip.mp4"),
      })
      .mockResolvedValueOnce({
        canceled: false,
        filePath: path.join(selectedDirectory, "vod.mp4"),
      });
    const dependencies = {
      getFallbackDirectory: () => fallbackDirectory,
      getRememberedDirectory: () => rememberedDirectory,
      rememberDirectory: (directory: string) => {
        rememberedDirectory = directory;
      },
      showSaveDialog,
    };

    await expect(
      chooseDownloadSavePath(
        {
          dialogTitle: "Save clip",
          channelName: "fpshero",
          title: "Ace",
          extension: "mp4",
          videoFilterName: "MP4 video",
        },
        dependencies
      )
    ).resolves.toBe(path.join(selectedDirectory, "clip.mp4"));

    await expect(
      chooseDownloadSavePath(
        {
          dialogTitle: "Save video",
          channelName: "speedrunpro",
          title: "Finals",
          extension: "mp4",
          videoFilterName: "MP4 video",
        },
        dependencies
      )
    ).resolves.toBe(path.join(selectedDirectory, "vod.mp4"));

    expect(showSaveDialog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ defaultPath: path.join(fallbackDirectory, "fpshero-Ace.mp4") })
    );
    expect(showSaveDialog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        defaultPath: path.join(selectedDirectory, "speedrunpro-Finals.mp4"),
      })
    );
  });

  it("keeps the remembered folder when the user cancels", async () => {
    const rememberedDirectory = path.resolve("selected-media");
    const rememberDirectory = vi.fn();

    await expect(
      chooseDownloadSavePath(
        {
          dialogTitle: "Save clip",
          channelName: "fpshero",
          title: "Ace",
          extension: "mp4",
          videoFilterName: "MP4 video",
        },
        {
          getFallbackDirectory: () => path.resolve("fallback-downloads"),
          getRememberedDirectory: () => rememberedDirectory,
          rememberDirectory,
          showSaveDialog: vi.fn(async () => ({ canceled: true })),
        }
      )
    ).resolves.toBeNull();

    expect(rememberDirectory).not.toHaveBeenCalled();
  });
});
