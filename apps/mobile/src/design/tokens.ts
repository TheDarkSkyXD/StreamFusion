import type { TextStyle } from "react-native";

export const mobileColors = {
  background: "#0f0f0f",
  surface: "#1a1a1a",
  surfaceMuted: "#252525",
  surfaceRaised: "#2d2d2d",
  navigationSelected: "#404040",
  border: "#333333",
  live: "#dc143c",
  danger: "#dc143c",
  textPrimary: "#ffffff",
  textSecondary: "#a0a0a0",
  textMuted: "#666666",
  textCategory: "#b2b2b2",
  tagSurface: "#4a4d55",
  tagSurfaceHover: "#5a5d66",
  tagText: "#efeff1",
  twitch: "#9146ff",
  twitchDeep: "#772ce8",
  twitchBright: "#a970ff",
  kick: "#53fc18",
  kickDeep: "#3dd912",
  kickBright: "#7aff4d",
  overlay: "rgba(0,0,0,0.72)",
  playerScrim: "rgba(15,15,15,0.42)",
  dividerMuted: "rgba(51,51,51,0.5)",
} as const;

export const mobileShadows = {
  popover: "0 4px 16px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)",
  toast: "0 2px 8px rgba(0,0,0,0.3)",
  dialog: "0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3)",
} as const;

export const mobilePressRing = {
  rest: {
    borderColor: "transparent",
    borderWidth: 1,
  },
  pressed: {
    borderColor: mobileColors.border,
  },
} as const;

export const mobileSpacing = {
  xSmall: 4,
  small: 8,
  medium: 16,
  large: 24,
  xLarge: 32,
} as const;

export const mobileRadii = {
  small: 4,
  medium: 8,
  large: 12,
  extraLarge: 16,
  full: 999,
} as const;

export const mobileSizing = {
  icon: 24,
  minimumTouchTarget: 48,
  navigationRailWidth: 104,
  compactWindowMaximum: 599,
  readableContentMaximum: 760,
} as const;

export const mobileMotion = {
  colorMs: 200,
  transformMs: 300,
} as const;

export const mobileType = {
  display: {
    color: mobileColors.textPrimary,
    fontSize: 24,
    fontWeight: "700",
    lineHeight: 29,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 20,
  },
  body: {
    color: mobileColors.textSecondary,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
  },
  label: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.3,
    lineHeight: 16,
  },
  caption: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
} as const satisfies Record<string, TextStyle>;
