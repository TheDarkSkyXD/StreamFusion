const HOUR_SECONDS = 60 * 60;
const MINUTE_SECONDS = 60;

function normalizePositiveSeconds(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function parseDurationSeconds(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return normalizePositiveSeconds(value);
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const colonParts = trimmed.split(":");
  if (colonParts.length > 1) {
    const numericParts = colonParts.map((part) => Number.parseInt(part, 10));
    if (numericParts.every((part) => Number.isFinite(part) && part >= 0)) {
      const seconds = numericParts.reduce((total, part) => total * 60 + part, 0);
      return normalizePositiveSeconds(seconds);
    }
  }

  const unitMatches = [...trimmed.matchAll(/(\d+(?:\.\d+)?)(h|m|s)/gi)];
  if (unitMatches.length > 0) {
    const seconds = unitMatches.reduce((total, match) => {
      const amount = Number.parseFloat(match[1]);
      switch (match[2].toLowerCase()) {
        case "h":
          return total + amount * HOUR_SECONDS;
        case "m":
          return total + amount * MINUTE_SECONDS;
        default:
          return total + amount;
      }
    }, 0);
    return normalizePositiveSeconds(seconds);
  }

  const numericSeconds = Number.parseFloat(trimmed);
  return normalizePositiveSeconds(numericSeconds);
}
