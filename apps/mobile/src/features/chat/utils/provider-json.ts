export function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function identifier(value: unknown): string {
  return typeof value === "number" ? String(value) : string(value);
}
