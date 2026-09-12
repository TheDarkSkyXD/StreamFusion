export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordAt(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

export function firstRecordAt(
  record: JsonRecord,
  key: string
): JsonRecord | null {
  const value = record[key];
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : null;
}

export function hasKey(record: JsonRecord, key: string): boolean {
  return Object.hasOwn(record, key);
}

export function dataFrom(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.filter(isRecord);
}

export function cursorFrom(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const pagination = recordAt(value, "pagination");
  const cursor = pagination?.cursor;
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

export function firstString(
  record: JsonRecord,
  keys: readonly string[]
): string {
  for (const key of keys) {
    const value = stringAt(record, key);
    if (value !== "") return value;
  }
  return "";
}

export function firstIdentifier(
  record: JsonRecord,
  keys: readonly string[]
): string {
  for (const key of keys) {
    const value = identifierAt(record, key);
    if (value !== "") return value;
  }
  return "";
}

export function firstNumber(
  record: JsonRecord,
  keys: readonly string[]
): number {
  return firstNumberOrNull(record, keys) ?? 0;
}

export function firstNumberOrNull(
  record: JsonRecord,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0)
      return value;
  }
  return null;
}

export function booleanAt(record: JsonRecord, key: string): boolean {
  return record[key] === true;
}

export function stringArrayAt(
  record: JsonRecord,
  key: string
): readonly string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function queryParams(input: Record<string, string>): string {
  return new URLSearchParams(input).toString();
}
