import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Platform } from "../shared/auth-types";

/**
 * Merge class names with Tailwind CSS classes
 * Uses clsx for conditional classes and tailwind-merge to avoid conflicts
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format viewer count to K/M format
 * e.g. 1200 -> 1.2K, 1500000 -> 1.5M
 */
export function formatViewerCount(count: number | undefined | null): string {
  if (!count) return "0";
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return count.toString();
}

/**
 * Format relative time (e.g. "2 hours ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return "just now";
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes}m ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours}h ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays}d ago`;
}

/**
 * Format duration in seconds to HH:MM:SS or MM:SS
 * Shows HH:MM:SS when duration is 1 hour or more (e.g. 04:21:10)
 * Shows MM:SS for shorter durations (e.g. 05:30)
 */
export function formatDuration(seconds: number): string {
  if (Number.isNaN(seconds) || seconds < 0) return "00:00";

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    // Format as HH:MM:SS with padded hours for long streams
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  // Format as MM:SS for shorter durations
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// Module-scope singleton — Intl.DisplayNames is expensive to construct.
const LANGUAGE_DISPLAY_NAMES = new Intl.DisplayNames(["en"], { type: "language" });

/**
 * Render a language label in consistent Title Case regardless of input format.
 * Handles BCP-47 codes from Twitch ("en" → "English") and full words from Kick
 * ("english" → "English"), so the chip reads the same on every surface.
 */
export function formatLanguageLabel(lang: string | null | undefined): string {
  if (!lang) return "";
  // BCP-47 code path (e.g. "en", "es"): try Intl, accept only if it actually resolved.
  if (lang.length <= 3) {
    try {
      const resolved = LANGUAGE_DISPLAY_NAMES.of(lang);
      if (resolved && resolved.toLowerCase() !== lang.toLowerCase()) return resolved;
    } catch {
      // Structurally invalid BCP-47 tag — fall through to title case.
    }
  }
  return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
}

// Curated equivalences for category names that differ between platforms.
// Symmetric names (e.g. "IRL" on both, "Grand Theft Auto V" on both) don't
// need entries — they match automatically via lowercase comparison.
// Add a row here only when the two platforms call the same thing different things.
const CATEGORY_EQUIVALENCES: Array<{ key: string; twitch: string; kick: string }> = [
  { key: "slots", twitch: "Slots & Casino", kick: "Slots" },
  { key: "grand-theft-auto-v", twitch: "Grand Theft Auto V", kick: "Grand Theft Auto V (GTA)" },
  { key: "counter-strike", twitch: "Counter-Strike", kick: "Counter-Strike 2" },
  { key: "black-desert", twitch: "Black Desert", kick: "Black Desert Online" },
];

const NAME_TO_KEY = new Map<string, string>();
for (const e of CATEGORY_EQUIVALENCES) {
  NAME_TO_KEY.set(e.twitch.toLowerCase(), e.key);
  NAME_TO_KEY.set(e.kick.toLowerCase(), e.key);
}

/**
 * Normalize category name to a canonical key for cross-platform comparison.
 * Asymmetric pairs (e.g. Twitch "Slots & Casino" ↔ Kick "Slots") map to a shared
 * key via CATEGORY_EQUIVALENCES; everything else falls back to lowercase.
 */
export function normalizeCategoryName(name: string): string {
  const lower = name.toLowerCase().trim();
  return NAME_TO_KEY.get(lower) ?? lower;
}

/**
 * Given a canonical key, return the preferred display name on the target platform,
 * or null if no curated equivalence exists for that key.
 */
export function getEquivalentCategoryName(key: string, platform: Platform): string | null {
  const entry = CATEGORY_EQUIVALENCES.find((e) => e.key === key);
  return entry ? entry[platform] : null;
}

/**
 * Format uptime from a startedAt ISO date string to HH:MM:SS format
 * e.g. "2025-12-10T21:00:00Z" -> "1:15:33" if stream has been live for 1 hour, 15 mins, 33 secs
 */
export function formatUptime(startedAt: string | undefined | null): string {
  if (!startedAt) return "0:00:00";

  let start = new Date(startedAt);

  // Robustness check: if invalid date, try parsing as UTC if it looks like YYYY-MM-DD HH:MM:SS
  if (Number.isNaN(start.getTime()) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(startedAt)) {
    start = new Date(`${startedAt.replace(" ", "T")}Z`);
  }

  // Final robustness check: if still invalid after UTC fallback, return safe default
  if (Number.isNaN(start.getTime())) {
    console.warn(`[formatUptime] Unable to parse date: ${startedAt}`);
    return "0:00:00";
  }

  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - start.getTime()) / 1000);

  if (diffInSeconds < 0) return "0:00:00";

  const hours = Math.floor(diffInSeconds / 3600);
  const minutes = Math.floor((diffInSeconds % 3600) / 60);
  const seconds = Math.floor(diffInSeconds % 60);

  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
