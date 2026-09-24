/**
 * Live Watch top-chrome meta helpers.
 *
 * Mirrors desktop stream-info formatting:
 * - viewer counts use locale grouping (e.g. 50,443), matching
 *   desktop `toLocaleString` / `formatLocalizedNumber` (not compact K/M)
 * - uptime uses desktop `formatUptime` shape: H:MM:SS
 */

const numberFormatters = new Map<string, Intl.NumberFormat>();

export function formatWatchViewerCount(
  count: number | undefined | null,
  locale = "en",
): string {
  const safe = typeof count === "number" && Number.isFinite(count) ? count : 0;
  const formatterLocale = locale || "en";
  let formatter = numberFormatters.get(formatterLocale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(formatterLocale);
    numberFormatters.set(formatterLocale, formatter);
  }
  return formatter.format(safe);
}

/**
 * Format live uptime from startedAt ISO → H:MM:SS (desktop formatUptime).
 * Returns null when startedAt is missing or unparseable so the UI can omit it.
 */
export function formatLiveUptime(
  startedAt: string | null | undefined,
  nowMs: number = Date.now(),
): string | null {
  if (!startedAt) return null;
  let start = new Date(startedAt);
  if (
    Number.isNaN(start.getTime()) &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(startedAt)
  ) {
    start = new Date(`${startedAt.replace(" ", "T")}Z`);
  }
  if (Number.isNaN(start.getTime())) return null;
  const diffInSeconds = Math.floor((nowMs - start.getTime()) / 1000);
  if (diffInSeconds < 0) return "0:00:00";
  const hours = Math.floor(diffInSeconds / 3600);
  const minutes = Math.floor((diffInSeconds % 3600) / 60);
  const seconds = Math.floor(diffInSeconds % 60);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

/** Top subline: `50,443` or `50,443 · 1:15:33` when uptime is available. */
export function formatWatchViewerLine(
  viewerCount: number,
  startedAt: string | null | undefined,
  nowMs: number = Date.now(),
  locale = "en",
): string {
  const viewers = formatWatchViewerCount(viewerCount, locale);
  const uptime = formatLiveUptime(startedAt, nowMs);
  return uptime === null ? viewers : `${viewers} · ${uptime}`;
}
