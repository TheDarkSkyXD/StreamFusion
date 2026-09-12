import type { FollowedIdentityRef } from "@streamfusion/core/relay";
import type { GuestFollow } from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";

export function identityRefsFor(
  follows: readonly GuestFollow[],
  platform: Platform,
): readonly FollowedIdentityRef[] {
  return follows.flatMap((follow) =>
    follow.platform === platform
      ? [{ kind: "id" as const, value: follow.channelId }]
      : [],
  );
}

export function requestInit(
  headers: HeadersInit,
  signal?: AbortSignal,
): RequestInit {
  return signal === undefined ? { headers } : { headers, signal };
}

export function matchesQuery(
  query: string,
  fields: readonly string[],
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return fields.some((field) => field.toLowerCase().includes(needle));
}

export const RECORDED_READ_CONCURRENCY = 6;

export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  load: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = items.slice(index, index + concurrency);
    results.push(...(await Promise.all(batch.map(load))));
  }
  return results;
}
