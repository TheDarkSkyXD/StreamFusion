import path from "node:path";

import { app, type BrowserWindow, dialog, type SaveDialogOptions } from "electron";

import { buildDownloadFilename } from "./download-paths";
import { storageService } from "./storage-service";

interface DownloadSavePathInput {
  dialogTitle: string;
  channelName: string;
  title: string;
  extension: string;
  videoFilterName: string;
}

interface DownloadSavePathDependencies {
  getFallbackDirectory: () => string;
  getRememberedDirectory: () => string | null;
  rememberDirectory: (directory: string) => void;
  showSaveDialog: (options: SaveDialogOptions) => Promise<{
    canceled: boolean;
    filePath?: string;
  }>;
}

export async function chooseDownloadSavePath(
  input: DownloadSavePathInput,
  dependencies: DownloadSavePathDependencies
): Promise<string | null> {
  const rememberedDirectory = dependencies.getRememberedDirectory();
  const directory =
    rememberedDirectory && path.isAbsolute(rememberedDirectory)
      ? rememberedDirectory
      : dependencies.getFallbackDirectory();
  const result = await dependencies.showSaveDialog({
    title: input.dialogTitle,
    defaultPath: path.join(
      directory,
      buildDownloadFilename(input.channelName, input.title, input.extension)
    ),
    filters: [{ name: input.videoFilterName, extensions: ["mp4"] }],
  });

  if (result.canceled || !result.filePath) return null;
  dependencies.rememberDirectory(path.dirname(result.filePath));
  return result.filePath;
}

export function chooseDefaultDownloadSavePath(
  mainWindow: BrowserWindow,
  input: DownloadSavePathInput
): Promise<string | null> {
  return chooseDownloadSavePath(input, {
    getFallbackDirectory: () => app.getPath("downloads"),
    getRememberedDirectory: () => storageService.getLastDownloadDirectory(),
    rememberDirectory: (directory) => storageService.saveLastDownloadDirectory(directory),
    showSaveDialog: (options) => dialog.showSaveDialog(mainWindow, options),
  });
}
