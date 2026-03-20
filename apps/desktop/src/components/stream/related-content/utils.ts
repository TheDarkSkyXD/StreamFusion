/**
 * Format a date string into a relative time ago format
 */
export function formatTimeAgo(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds <= 0) return "Just now";

    let interval = seconds / 31536000;
    if (interval > 1) return `${Math.floor(interval)} years ago`;

    interval = seconds / 2592000;
    if (interval > 1) return `${Math.floor(interval)} months ago`;

    interval = seconds / 86400;
    if (interval > 1) {
      const days = Math.floor(interval);
      if (days === 1) return "Yesterday";
      return `${days} days ago`;
    }

    interval = seconds / 3600;
    if (interval > 1) return `${Math.floor(interval)} hours ago`;

    interval = seconds / 60;
    if (interval > 1) return `${Math.floor(interval)} mins ago`;

    return `${Math.floor(seconds)} seconds ago`;
  } catch (_e) {
    return dateString; // Fallback
  }
}

/**
 * Format view counts into a human-readable format (1K, 1.5M, etc.)
 */
export function formatViews(views: string | number): string {
  const num = typeof views === "string" ? parseInt(views.replace(/,/g, ""), 10) : views;
  if (Number.isNaN(num)) return String(views);

  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  }
  return num.toString();
}
