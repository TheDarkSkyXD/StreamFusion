import type { Platform } from "@streamfusion/core/platform";

/**
 * Desktop-parity username color resolution for Watch chat.
 * Mirrors `apps/desktop/.../presentation/chat-visuals.ts` `resolveChatUsernameColor`.
 */
function deterministicUsernameColor(username: string): string {
  let hash = 0;
  for (let index = 0; index < username.length; index += 1) {
    hash = username.charCodeAt(index) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 65%)`;
}

function hexLuminance(hex: string): number {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 1;

  const value = Number.parseInt(match[1], 16);
  const channel = (component: number) => {
    const normalized = component / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * channel((value >> 16) & 0xff) +
    0.7152 * channel((value >> 8) & 0xff) +
    0.0722 * channel(value & 0xff)
  );
}

function liftForDarkTheme(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || hexLuminance(hex) >= 0.18) return hex;

  const value = Number.parseInt(match[1], 16);
  const mixWithWhite = (component: number) => Math.round(component + (255 - component) * 0.5);
  const red = mixWithWhite((value >> 16) & 0xff);
  const green = mixWithWhite((value >> 8) & 0xff);
  const blue = mixWithWhite(value & 0xff);

  return `#${((red << 16) | (green << 8) | blue).toString(16).padStart(6, "0")}`;
}

export function resolveChatUsernameColor({
  color,
  platform,
  readableColorForUncolored,
  themeAdaptUsernameColor,
  username,
}: {
  color?: string;
  platform: Platform;
  readableColorForUncolored: boolean;
  themeAdaptUsernameColor: boolean;
  username: string;
}): string {
  if (!color) {
    if (readableColorForUncolored) return deterministicUsernameColor(username);
    return platform === "kick" ? "#53fc18" : "#9146ff";
  }

  return themeAdaptUsernameColor ? liftForDarkTheme(color) : color;
}