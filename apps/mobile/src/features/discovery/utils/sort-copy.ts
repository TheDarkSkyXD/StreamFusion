export function sortCopy<T>(
  items: readonly T[],
  compare: (left: T, right: T) => number,
): T[] {
  return [...items].sort(compare);
}
