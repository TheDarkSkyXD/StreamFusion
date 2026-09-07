import type { CSSProperties } from "react";

import type { TimestampFormat } from "@shared/auth-types";
import type { SevenTvPaint } from "@shared/chat-types";
import { Platform as ChatPlatform } from "@streamfusion/core/platform";

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
  platform: ChatPlatform;
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

export function getSevenTvPaintStyle(
  paint: SevenTvPaint | undefined,
  fallbackColor: string
): CSSProperties | null {
  if (!paint) return null;

  let backgroundImage: string | undefined;
  if (paint.function === "url") {
    try {
      const url = new URL(paint.imageUrl ?? "");
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      backgroundImage = `url(${JSON.stringify(url.href)})`;
    } catch {
      return null;
    }
  } else {
    const stops = paint.stops
      .filter((stop) => Number.isFinite(stop.at) && /^rgba?\(/.test(stop.color))
      .toSorted((left, right) => left.at - right.at);
    if (stops.length < 2) return null;

    const stopList = stops
      .map((stop) => `${stop.color} ${Math.min(100, Math.max(0, stop.at * 100))}%`)
      .join(", ");

    if (paint.function === "linear-gradient") {
      const angle = Number.isFinite(paint.angle) ? (paint.angle ?? 0) - 90 : -90;
      backgroundImage = `${paint.repeat ? "repeating-" : ""}linear-gradient(${angle}deg, ${stopList})`;
    } else {
      const shape = paint.shape === "ellipse" ? "ellipse" : "circle";
      backgroundImage = `${paint.repeat ? "repeating-" : ""}radial-gradient(${shape}, ${stopList})`;
    }
  }

  return {
    color: "transparent",
    backgroundColor: fallbackColor,
    backgroundImage,
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundRepeat: paint.repeat ? "repeat" : "no-repeat",
    backgroundSize: paint.function === "url" ? "100% 100%" : undefined,
    textShadow:
      paint.shadows
        .map(
          (shadow) => `${shadow.xOffset}px ${shadow.yOffset}px ${shadow.radius}px ${shadow.color}`
        )
        .join(", ") || undefined,
  };
}

export function formatChatTimestamp(timestamp: Date, format: TimestampFormat): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const hours24 = date.getHours();
  const is12Hour = format.startsWith("h");
  const padHour = format.startsWith("HH") || format.startsWith("hh");
  const includeSeconds = format.includes(":ss");
  const hour = is12Hour ? hours24 % 12 || 12 : hours24;
  const hourText = padHour ? String(hour).padStart(2, "0") : String(hour);
  const minuteText = String(date.getMinutes()).padStart(2, "0");
  const secondText = includeSeconds ? `:${String(date.getSeconds()).padStart(2, "0")}` : "";
  const meridiem = is12Hour ? ` ${hours24 < 12 ? "AM" : "PM"}` : "";

  return `${hourText}:${minuteText}${secondText}${meridiem}`;
}
