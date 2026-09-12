import type { SignedOutChannelBody } from "@streamfusion/core/relay";

type JsonRecord = Record<string, unknown>;
type CatalogTimestamp = NonNullable<
  SignedOutChannelBody["channel"]["createdAt"]
>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function dataFrom(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  return value.data.filter(isRecord);
}

export function cursorFrom(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const pagination = isRecord(value.pagination) ? value.pagination : null;
  const cursor = pagination?.cursor ?? value.cursor;
  return typeof cursor === "string" && cursor.length > 0 && cursor.length <= 512
    ? cursor
    : undefined;
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

export function recordAt(record: JsonRecord, key: string): JsonRecord | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

export function timestampAt(
  record: JsonRecord,
  key: string
): CatalogTimestamp | undefined {
  const value = record[key];
  if (typeof value !== "string" || value === "") return undefined;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return undefined;
  return timestamp.toISOString() as CatalogTimestamp;
}

export function requiredTimestamp(
  value: CatalogTimestamp | undefined
): CatalogTimestamp {
  return value ?? ("1970-01-01T00:00:00.000Z" as CatalogTimestamp);
}

export function helixDurationSeconds(value: string): number {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/u.exec(value);
  if (match === null) return 0;
  return (
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0)
  );
}

export function queryParams(input: Record<string, string>): string {
  return new URLSearchParams(input).toString();
}

export function lookupChannelId(input: {
  readonly id?: string;
  readonly login?: string;
}): string {
  return input.id ?? input.login ?? "";
}
