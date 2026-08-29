/**
 * Platform Assets Index
 *
 * Exports brand assets for all supported platforms.
 */

import type { Platform } from "../../../shared/auth-types";

export * from "./kick";
// Platform-specific exports
export * from "./twitch";

// Re-export with namespaces
import * as KickAssets from "./kick";
import * as TwitchAssets from "./twitch";

// ========== Platform Color Helper ==========

/**
 * Get the primary brand color for a platform
 */
export function getPlatformColor(platform: Platform): string {
  switch (platform) {
    case "twitch":
      return TwitchAssets.TWITCH_COLORS.primary;
    case "kick":
      return KickAssets.KICK_COLORS.primary;
    default:
      return "#9146FF"; // Default to Twitch purple
  }
}

/**
 * Get platform display name
 */
function getPlatformName(platform: Platform): string {
  switch (platform) {
    case "twitch":
      return "Twitch";
    case "kick":
      return "Kick";
    default:
      return platform;
  }
}

/**
 * Get platform logo URL
 */
function getPlatformLogo(platform: Platform): string {
  switch (platform) {
    case "twitch":
      return TwitchAssets.TWITCH_PLATFORM.logoUrl;
    case "kick":
      return KickAssets.KICK_PLATFORM.logoUrl;
    default:
      return "";
  }
}

/**
 * Get all CSS variables for a platform
 */
function getPlatformCssVariables(platform: Platform): Record<string, string> {
  switch (platform) {
    case "twitch":
      return TwitchAssets.getTwitchCssVariables();
    case "kick":
      return KickAssets.getKickCssVariables();
    default:
      return {};
  }
}
