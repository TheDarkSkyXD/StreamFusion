import path from "node:path";

import { app, clipboard, Menu, type MenuItemConstructorOptions, shell } from "electron";

import { getCurrentLogPath } from "./logging/logger";
import { getCurrentNetworkPath } from "./logging/network-logger";
import { getCurrentNoisePath } from "./logging/noise-logger";
import { getNativeText } from "./services/native-copy";

export function installApplicationMenu(): void {
  const viewMenu: MenuItemConstructorOptions = app.isPackaged
    ? {
        label: getNativeText("viewMenu"),
        submenu: [
          { role: "resetZoom", label: getNativeText("resetZoom") },
          { role: "zoomIn", label: getNativeText("zoomIn") },
          { role: "zoomOut", label: getNativeText("zoomOut") },
          { type: "separator" },
          { role: "togglefullscreen", label: getNativeText("toggleFullscreen") },
        ],
      }
    : { role: "viewMenu", label: getNativeText("viewMenu") };
  const menu = Menu.buildFromTemplate([
    { role: "fileMenu", label: getNativeText("fileMenu") },
    { role: "editMenu", label: getNativeText("editMenu") },
    viewMenu,
    { role: "windowMenu", label: getNativeText("windowMenu") },
    {
      role: "help",
      label: getNativeText("helpMenu"),
      submenu: [
        {
          label: getNativeText("openLogsFolder"),
          click: () => {
            void shell.openPath(path.dirname(getCurrentLogPath()));
          },
        },
        {
          label: getNativeText("copyLogPath"),
          click: () => clipboard.writeText(getCurrentLogPath()),
        },
        {
          label: getNativeText("copyNoiseLogPath"),
          click: () => {
            try {
              clipboard.writeText(getCurrentNoisePath());
            } catch {
              return;
            }
          },
        },
        {
          label: getNativeText("copyNetworkLogPath"),
          click: () => {
            try {
              clipboard.writeText(getCurrentNetworkPath());
            } catch {
              return;
            }
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}
