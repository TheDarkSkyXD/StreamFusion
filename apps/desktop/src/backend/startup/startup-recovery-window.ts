import { BrowserWindow, dialog } from "electron";

import { logger } from "@backend/logging/logger";

let recoveryWindow: BrowserWindow | null = null;

export function buildStartupRecoveryUrl(diagnosticId: string): string {
  const safeId = diagnosticId.replaceAll(/[^a-zA-Z0-9-]/g, "");
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>StreamFusion recovery</title><style>body{margin:0;background:#111318;color:#fff;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{max-width:36rem;padding:2rem;border:1px solid #545a66;border-radius:14px;background:#1b1e25;text-align:center}p{color:#b9bec8;line-height:1.5}.id{font:13px ui-monospace,monospace;color:#d6d8de;user-select:all}</style><main class="card"><h1>StreamFusion couldn’t start safely</h1><p>Your saved data was not removed. Close and reopen the app. If this happens again, include the diagnostic ID below with a bug report.</p><p class="id">${safeId || "unavailable"}</p></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function openStartupRecoveryWindow(diagnosticId: string): BrowserWindow {
  if (recoveryWindow && !recoveryWindow.isDestroyed()) return recoveryWindow;

  recoveryWindow = new BrowserWindow({
    width: 680,
    height: 440,
    minWidth: 520,
    minHeight: 360,
    show: false,
    backgroundColor: "#111318",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  recoveryWindow.once("ready-to-show", () => recoveryWindow?.show());
  recoveryWindow.once("closed", () => {
    recoveryWindow = null;
  });
  void recoveryWindow.loadURL(buildStartupRecoveryUrl(diagnosticId)).catch((error: unknown) => {
    logger.error("Startup:Recovery", "Could not load startup recovery page", {
      diagnosticId,
      error: error instanceof Error ? { name: error.name } : undefined,
    });
    dialog.showErrorBox(
      "StreamFusion couldn’t start safely",
      `Your saved data was not removed. Restart the app and include diagnostic ID ${diagnosticId} if this repeats.`
    );
  });
  return recoveryWindow;
}
