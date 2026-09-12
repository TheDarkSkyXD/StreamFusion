export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function dataFrom(value: unknown): JsonRecord[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.filter(isRecord);
}

export function cursorFrom(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.pagination)) return null;
  const cursor = value.pagination.cursor;
  return typeof cursor === "string" && cursor.length > 0 && cursor.length <= 512
    ? cursor
    : null;
}

export function stringAt(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

export function identifierAt(record: JsonRecord, key: string): string {
  const value = record[key];
  return typeof value === "string"
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? `${value}`
      : "";
}

export function firstString(record: JsonRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringAt(record, key);
    if (value !== "") return value;
  }
  return "";
}

export function nonNegativeNumberAt(record: JsonRecord, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function booleanAt(record: JsonRecord, key: string): boolean {
  return record[key] === true;
}

export function stringArrayAt(record: JsonRecord, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function queryParams(input: Record<string, string>): string {
  return new URLSearchParams(input).toString();
}

export function helixTimestamp(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return date.toISOString();
}

export function helixDurationSeconds(value: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (match === null) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3_600 + minutes * 60 + seconds;
}
