/**
 * Platform Assets - Kick
 *
 * Kick brand colors, logos, and styling constants.
 * Use these for consistent Kick branding throughout the app.
 */

// Export bundled badge assets
export * from "./badges";

// ========== Brand Colors ==========

export const KICK_COLORS = {
  // Primary brand color
  primary: "#53FC18", // Kick Green
  primaryLight: "#7DFD4A",
  primaryDark: "#3FC912",

  // Background colors
  background: "#0B0E0F",
  backgroundAlt: "#141718",
  backgroundElevated: "#1E2124",

  // Text colors
  textPrimary: "#FFFFFF",
  textSecondary: "#A3A3A3",
  textMuted: "#6B6B6B",

  // Accent colors
  accent: "#53FC18",
  live: "#FF0000", // Live indicator red
  online: "#53FC18", // Online indicator (same as primary)

  // Interactive
  hover: "#1E2124",
  focus: "#53FC18",
} as const;

// ========== Typography ==========

export const KICK_FONTS = {
  primary: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
  monospace: '"JetBrains Mono", "Fira Code", monospace',
} as const;

// ========== Platform Info ==========

export const KICK_PLATFORM = {
  name: "Kick",
  shortName: "kick",
  domain: "kick.com",
  logoUrl: "/assets/platforms/kick/logo.svg",
  iconUrl: "/assets/platforms/kick/icon.svg",
} as const;

// ========== CSS Variables Export ==========

export function getKickCssVariables(): Record<string, string> {
  return {
    "--kick-primary": KICK_COLORS.primary,
    "--kick-primary-light": KICK_COLORS.primaryLight,
    "--kick-primary-dark": KICK_COLORS.primaryDark,
    "--kick-bg": KICK_COLORS.background,
    "--kick-bg-alt": KICK_COLORS.backgroundAlt,
    "--kick-bg-elevated": KICK_COLORS.backgroundElevated,
    "--kick-text": KICK_COLORS.textPrimary,
    "--kick-text-secondary": KICK_COLORS.textSecondary,
    "--kick-live": KICK_COLORS.live,
  };
}
