/**
 * Emote System Exports
 *
 * Central export point for all emote-related services and types.
 */

// Manager
export { emoteManager } from "./emote-manager";
// Types
export * from "./emote-types";

// Providers

import { sevenTVEmoteProvider } from "./7tv-emotes";
import { bttvEmoteProvider } from "./bttv-emotes";
// Initialize providers with the manager
import { emoteManager } from "./emote-manager";
import { ffzEmoteProvider } from "./ffz-emotes";
import { kickEmoteProvider } from "./kick-emotes";
import { twitchEmoteProvider } from "./twitch-emotes";

/**
 * Register all emote providers with the manager
 * Call this during app initialization
 */
function initializeEmoteProviders(): void {
  emoteManager.registerProvider(twitchEmoteProvider);
  emoteManager.registerProvider(kickEmoteProvider);
  emoteManager.registerProvider(bttvEmoteProvider);
  emoteManager.registerProvider(ffzEmoteProvider);
  emoteManager.registerProvider(sevenTVEmoteProvider);
}

let emoteProvidersInitialized = false;

/**
 * Idempotent variant of initializeEmoteProviders for use from feature mount
 * points (e.g. ChatPanel). Pages with no chat don't pay the cost of loading
 * and registering five providers at app boot.
 */
export function ensureEmoteProvidersInitialized(): void {
  if (emoteProvidersInitialized) return;
  emoteProvidersInitialized = true;
  initializeEmoteProviders();
}

/**
 * Enable the Twitch provider. Its Helix requests cross the typed main-process bridge.
 */
export async function initializeTwitchEmotes(): Promise<void> {
  try {
    const status = await window.electronAPI.auth.tokenStatus("twitch");
    if (status.connected && status.valid) {
      twitchEmoteProvider.configure();
      return;
    }
  } catch {
    // Treat an unavailable auth capability as signed out. The next chat mount
    // or identity change rechecks status before enabling Helix emote reads.
  }
  twitchEmoteProvider.disable();
}

/**
 * Configure Kick provider with credentials
 * @param accessToken - Kick OAuth access token
 */
export function initializeKickEmotes(accessToken: string): void {
  kickEmoteProvider.configure(accessToken);
}
