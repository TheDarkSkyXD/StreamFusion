import {
  toSerializedTimestamp,
  type SerializedTimestamp,
} from "@streamfusion/core/content";

export function helixDurationSeconds(value: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(value);
  if (match === null) return 0;
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
}

export function canonicalTimestamp(
  value: string,
): SerializedTimestamp | undefined {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return undefined;
  return toSerializedTimestamp(timestamp.toISOString());
}

export function stringField(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

export function identifierField(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value === "string") return value;
  return typeof value === "number" && Number.isFinite(value) ? `${value}` : "";
}

export function numberField(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function helixRows(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return [];
  }
  const data = (value as { data: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((row) =>
    typeof row === "object" && row !== null && !Array.isArray(row)
      ? [row as Record<string, unknown>]
      : [],
  );
}
