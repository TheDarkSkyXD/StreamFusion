import type { DeveloperWidgetOverlayCapability } from "../../capabilities/developer-widget-overlay";

export const electronDeveloperWidgetOverlay = {
  supported: () =>
    import.meta.env.DEV &&
    /Electron/.test(navigator.userAgent) &&
    /Win/.test(navigator.platform) &&
    typeof window.electronAPI?.developerWidgets?.arm === "function",
  arm: () => window.electronAPI.developerWidgets.arm(),
  updateLayout: (layout) => window.electronAPI.developerWidgets.updateLayout(layout),
  close: () => window.electronAPI.developerWidgets.close(),
} satisfies DeveloperWidgetOverlayCapability;
