import { useEffect, useEffectEvent, useState } from "react";

import { prewarmViewportImages } from "@/lib/viewport-image-prewarm";

interface PersistedSnapshot<T> {
  version: 1;
  identity: string;
  savedAt: number;
  data: T;
}

interface SnapshotOptions<T> {
  slot: string;
  identity: unknown;
  maxAgeMs: number;
  isUsable: (data: unknown) => data is T;
  getImageUrls?: (data: T) => Array<string | null | undefined>;
  enabled?: boolean;
}

const PREFIX = "browse-query-snapshot:v1:";

function snapshotKey(slot: string): string {
  return `${PREFIX}${slot}`;
}

export async function loadPersistedSnapshot<T>({
  slot,
  identity,
  maxAgeMs,
  isUsable,
  enabled = true,
}: SnapshotOptions<T>): Promise<T | undefined> {
  if (!enabled) return undefined;
  const identityKey = JSON.stringify(identity);
  const snapshot = await window.electronAPI.store.get(snapshotKey(slot));
  const now = Date.now();
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    !("version" in snapshot) ||
    snapshot.version !== 1 ||
    !("identity" in snapshot) ||
    snapshot.identity !== identityKey ||
    !("savedAt" in snapshot) ||
    typeof snapshot.savedAt !== "number" ||
    !Number.isFinite(snapshot.savedAt) ||
    snapshot.savedAt > now ||
    now - snapshot.savedAt > maxAgeMs ||
    !("data" in snapshot) ||
    !isUsable(snapshot.data)
  ) {
    return undefined;
  }
  return snapshot.data;
}

export function usePersistedSnapshot<T>({
  slot,
  identity,
  maxAgeMs,
  isUsable,
  getImageUrls,
  enabled = true,
}: SnapshotOptions<T>): T | undefined {
  const identityKey = JSON.stringify(identity);
  const validate = useEffectEvent((data: unknown): data is T => isUsable(data));
  const imageUrls = useEffectEvent((data: T) => getImageUrls?.(data));
  const [state, setState] = useState<{ identity: string; data?: T }>({ identity: identityKey });

  // biome-ignore lint/correctness/useExhaustiveDependencies: identityKey is the canonical serialized dependency; object identity may change every render
  useEffect(() => {
    let cancelled = false;
    if (!enabled) return;

    void loadPersistedSnapshot({ slot, identity, maxAgeMs, isUsable: validate })
      .then((data) => {
        if (cancelled) return;
        if (data) {
          const urls = imageUrls(data);
          if (urls) void prewarmViewportImages(urls);
        }
        setState({ identity: identityKey, data });
      })
      .catch(() => {
        if (!cancelled) setState({ identity: identityKey });
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identityKey is the canonical serialized dependency.
  }, [enabled, identityKey, maxAgeMs, slot]);

  return state.identity === identityKey ? state.data : undefined;
}

export async function savePersistedSnapshot<T>(
  slot: string,
  identity: unknown,
  data: T
): Promise<void> {
  const snapshot: PersistedSnapshot<T> = {
    version: 1,
    identity: JSON.stringify(identity),
    savedAt: Date.now(),
    data,
  };
  await window.electronAPI.store.set(snapshotKey(slot), snapshot);
}

export async function deletePersistedSnapshot(slot: string): Promise<void> {
  await window.electronAPI.store.delete(snapshotKey(slot));
}
