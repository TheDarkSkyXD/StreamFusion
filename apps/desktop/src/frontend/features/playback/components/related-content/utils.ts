/**
 * Format a date string into a relative time ago format
 */
export function formatTimeAgo(dateString: string): string {
  const timestamp = Date.parse(dateString);
  if (!Number.isFinite(timestamp)) {
    return dateString;
  }

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const formatter = getRelativeTimeFormatter(i18n.resolvedLanguage);
  if (seconds < 60) return formatter.format(-seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatter.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 30) return formatter.format(-days, "day");
  const months = Math.floor(days / 30);
  if (months < 12) return formatter.format(-months, "month");
  return formatter.format(-Math.floor(months / 12), "year");
}

/**
 * Format view counts into a human-readable format (1K, 1.5M, etc.)
 */
export function formatViews(views: string | number): string {
  const num = typeof views === "string" ? parseInt(views.replace(/,/g, ""), 10) : views;
  if (Number.isNaN(num)) return String(views);

  return formatCompactNumber(num);
}
import { i18n } from "@/i18n";
import { formatCompactNumber, getRelativeTimeFormatter } from "@/lib/utils";
