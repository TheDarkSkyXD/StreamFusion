import { app, BrowserWindow, dialog } from "electron";

import { logger } from "@backend/logging/logger";
import { getDisplayLanguage, resolveDisplayLanguage } from "@shared/display-language";
import { nativeText } from "@shared/i18n/native-copy.generated";

let recoveryWindow: BrowserWindow | null = null;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildStartupRecoveryUrl(diagnosticId: string, language = "en"): string {
  const resolvedLanguage = resolveDisplayLanguage(language);
  const direction = getDisplayLanguage(resolvedLanguage).direction;
  const safeId = diagnosticId.replaceAll(/[^a-zA-Z0-9-]/g, "");
  const title = escapeHtml(nativeText(language, "startupRecoveryTitle"));
  const heading = escapeHtml(nativeText(language, "startupRecoveryHeading"));
  const body = escapeHtml(nativeText(language, "startupRecoveryBody"));
  const unavailable = escapeHtml(nativeText(language, "unavailable"));
  const html = `<!doctype html><html lang="${resolvedLanguage}" dir="${direction}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title><style>body{margin:0;background:#111318;color:#fff;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{max-width:36rem;padding:2rem;border:1px solid #545a66;border-radius:14px;background:#1b1e25;text-align:center}p{color:#b9bec8;line-height:1.5}.id{font:13px ui-monospace,monospace;color:#d6d8de;user-select:all}</style></head><body><main class="card"><h1>${heading}</h1><p>${body}</p><p class="id">${safeId || unavailable}</p></main></body></html>`;
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
  void recoveryWindow
    .loadURL(buildStartupRecoveryUrl(diagnosticId, app.getLocale()))
    .catch((error: unknown) => {
      logger.error("Startup:Recovery", "Could not load startup recovery page", {
        diagnosticId,
        error: error instanceof Error ? { name: error.name } : undefined,
      });
      dialog.showErrorBox(
        nativeText(app.getLocale(), "startupRecoveryHeading"),
        nativeText(app.getLocale(), "startupRecoveryFallback", { diagnosticId })
      );
    });
  return recoveryWindow;
}
