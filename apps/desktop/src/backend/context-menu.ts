/**
 * Right-click context menu for the main window.
 *
 * `buildContextMenuTemplate` is a pure function so it can be unit-tested
 * without an Electron runtime. `installContextMenu` is the side-effecting
 * wrapper that attaches the listener to a WebContents.
 *
 * Scope: Copy on selection, Paste in editables. Spec:
 * docs/brainstorms/2026-05-28-context-menu-copy-paste-requirements.md
 */

import {
  BrowserWindow,
  Menu,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

export function buildContextMenuTemplate(
  params: Pick<ContextMenuParams, "selectionText" | "isEditable">,
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [];
  if (params.selectionText.trim().length > 0) {
    template.push({ role: "copy" });
  }
  if (params.isEditable) {
    template.push({ role: "paste" });
  }
  return template;
}

/** Attach only to the main BrowserWindow's webContents. Spec R10–R12 exclude
 *  the auth popup and the headless API-fetching windows from this menu. */
export function installContextMenu(webContents: WebContents): void {
  webContents.on("context-menu", (_event, params) => {
    const template = buildContextMenuTemplate(params);
    if (template.length === 0) return;
    const window = BrowserWindow.fromWebContents(webContents);
    if (!window) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
}
