import {
  toSerializedTimestamp,
  type SerializedTimestamp
} from "@streamfusion/core/relay";

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function dataFrom(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.filter(isRecord);
}

export function cursorFrom(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const pagination = isRecord(value.pagination) ? value.pagination : null;
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

export function nonNegativeNumberAt(record: JsonRecord, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function booleanAt(record: JsonRecord, key: string): boolean {
  return record[key] === true;
}

export function hasKey(record: JsonRecord, key: string): boolean {
  return Object.hasOwn(record, key);
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

export function recordAt(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

export function helixQuery(
  params: readonly (readonly [string, string])[]
): string {
  const search = new URLSearchParams();
  for (const [key, value] of params) search.append(key, value);
  return search.toString();
}

export function helixTimestamp(value: string): SerializedTimestamp | null {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return toSerializedTimestamp(date.toISOString());
}

export function helixDurationSeconds(record: JsonRecord, key: string): number {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value !== "string") return 0;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(value);
  if (match === null) return 0;
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
}

export function sizedUrl(
  record: JsonRecord,
  key: string,
  width: string,
  height: string
): string {
  return stringAt(record, key)
    .replaceAll("{width}", width)
    .replaceAll("{height}", height);
}
