declare const serializedTimestampBrand: unique symbol;

export type SerializedTimestamp = string & {
  readonly [serializedTimestampBrand]: true;
};

export type ContractSchema<TValue> = {
  is(value: unknown): value is TValue;
};

export function toSerializedTimestamp(value: string): SerializedTimestamp {
  if (!isSerializedTimestamp(value)) {
    throw new RangeError("Timestamp must be a canonical UTC ISO string");
  }

  return value;
}

export function isSerializedTimestamp(
  value: unknown,
): value is SerializedTimestamp {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return (
    !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value
  );
}

export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

export function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

export function isOptional<TValue>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is TValue,
): value is TValue | undefined {
  return value === undefined || predicate(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

export function isArrayOf<TValue>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is TValue,
): value is readonly TValue[] {
  return Array.isArray(value) && value.every(predicate);
}

export function isStringArray(value: unknown): value is readonly string[] {
  return isArrayOf(value, isString);
}
