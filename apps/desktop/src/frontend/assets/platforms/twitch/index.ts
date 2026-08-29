/**
 * Platform Assets - Twitch
 *
 * Twitch brand colors, logos, and styling constants.
 * Use these for consistent Twitch branding throughout the app.
 */

// ========== Brand Colors ==========

export const TWITCH_COLORS = {
  // Primary brand color
  primary: "#9146FF", // Twitch Purple
  primaryLight: "#A970FF",
  primaryDark: "#772CE8",

  // Background colors
  background: "#0E0E10",
  backgroundAlt: "#18181B",
  backgroundElevated: "#1F1F23",

  // Text colors
  textPrimary: "#EFEFF1",
  textSecondary: "#ADADB8",
  textMuted: "#848494",

  // Accent colors
  accent: "#BF94FF",
  live: "#EB0400", // Live indicator red
  online: "#00F593", // Online indicator green

  // Interactive
  hover: "#26262C",
  focus: "#772CE8",
} as const;

// ========== Typography ==========

export const TWITCH_FONTS = {
  primary: '"Inter", "Roobert", "Helvetica Neue", Helvetica, Arial, sans-serif',
  monospace: '"JetBrains Mono", "Fira Code", monospace',
} as const;

// ========== Platform Info ==========

export const TWITCH_PLATFORM = {
  name: "Twitch",
  shortName: "twitch",
  domain: "twitch.tv",
  logoUrl: "/assets/platforms/twitch/logo.svg",
  iconUrl: "/assets/platforms/twitch/icon.svg",
} as const;

// ========== CSS Variables Export ==========

export function getTwitchCssVariables(): Record<string, string> {
  return {
    "--twitch-primary": TWITCH_COLORS.primary,
    "--twitch-primary-light": TWITCH_COLORS.primaryLight,
    "--twitch-primary-dark": TWITCH_COLORS.primaryDark,
    "--twitch-bg": TWITCH_COLORS.background,
    "--twitch-bg-alt": TWITCH_COLORS.backgroundAlt,
    "--twitch-bg-elevated": TWITCH_COLORS.backgroundElevated,
    "--twitch-text": TWITCH_COLORS.textPrimary,
    "--twitch-text-secondary": TWITCH_COLORS.textSecondary,
    "--twitch-live": TWITCH_COLORS.live,
  };
}
