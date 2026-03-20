/**
 * Cosmetic Injection Service
 *
 * Handles CSS injection and scriptlet execution for ad element hiding.
 * Inspired by Ghostery's insertCSS and executeJavaScript patterns.
 */

import type { BrowserWindow } from "electron";

// CSS rules to hide Twitch ad elements (if they ever appear in our context)
const TWITCH_COSMETIC_CSS = `
/* Hide any ad-related overlays that might slip through */
[data-test-selector="ad-banner-default-text"],
[data-test-selector="sad-overlay"],
.video-player__overlay[data-a-target="player-overlay-click-handler"]:has(.stream-display-ad),
.player-ad-overlay,
.player-streamlink-ad,
.video-player__default-player > .tw-absolute:has(img[alt*="ad"]),
.video-player__container .tw-absolute.tw-c-background-overlay {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* Ensure video is always visible */
video {
  visibility: visible !important;
  opacity: 1 !important;
}
`;

// Scriptlet to intercept ad-related function calls (Ghostery pattern)
const TWITCH_SCRIPTLETS = `
(function() {
  'use strict';
  
  // Abort on property read - defensively intercepts ad-related property access
  // Runs early and checks configurability before attempting to redefine
  const abortOnPropertyRead = (obj, prop) => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(obj, prop);
      // Skip if property exists and is non-configurable
      if (descriptor && descriptor.configurable === false) {
        return;
      }
      // Preserve existing value if present
      const existingValue = obj[prop];
      Object.defineProperty(obj, prop, {
        configurable: true,
        get: function() {
          throw new ReferenceError('Blocked by StreamFusion AdBlock');
        },
        set: function() {}
      });
    } catch(e) {
      // Silently fail if property cannot be redefined
    }
  };
  
  // Unconditionally trap ad-related globals at script start for early interception
  abortOnPropertyRead(window, 'twitchAdConfig');
})();
`;

class CosmeticInjectionService {
  private isEnabled = true;
  private injectedWindows = new WeakSet<Electron.WebContents>();

  initialize(): void {
    // IPC handler registered in adblock-handlers.ts to avoid duplicate registration
    console.debug("[CosmeticInjection] Service initialized");
  }

  // Inject into a specific window (called on window creation)
  async injectIntoWindow(window: BrowserWindow): Promise<void> {
    if (!this.isEnabled) return;
    if (this.injectedWindows.has(window.webContents)) return;

    try {
      await window.webContents.insertCSS(TWITCH_COSMETIC_CSS, { cssOrigin: "user" });
      await window.webContents.executeJavaScript(TWITCH_SCRIPTLETS, true);
      this.injectedWindows.add(window.webContents);
      console.debug("[CosmeticInjection] Injected into window");
    } catch (e) {
      console.error("[CosmeticInjection] Failed to inject into window:", e);
    }
  }

  // Inject into WebContents directly (called from IPC handler)
  async injectIntoWebContents(
    webContents: Electron.WebContents
  ): Promise<{ injected: boolean; error?: string }> {
    if (!this.isEnabled) {
      return { injected: false, error: "cosmetic injection disabled" };
    }

    if (this.injectedWindows.has(webContents)) {
      return { injected: true }; // Already injected
    }

    try {
      await webContents.insertCSS(TWITCH_COSMETIC_CSS, { cssOrigin: "user" });
      await webContents.executeJavaScript(TWITCH_SCRIPTLETS, true);
      this.injectedWindows.add(webContents);
      console.debug("[CosmeticInjection] Injected into WebContents");
      return { injected: true };
    } catch (e) {
      console.error("[CosmeticInjection] Failed to inject into WebContents:", e);
      return { injected: false, error: String(e) };
    }
  }

  enable(): void {
    this.isEnabled = true;
  }
  disable(): void {
    this.isEnabled = false;
  }
  isActive(): boolean {
    return this.isEnabled;
  }
}

export const cosmeticInjectionService = new CosmeticInjectionService();
