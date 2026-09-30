import { useMemo } from "react";

import { SHARED_MAX_FLOOR_BYTES_PER_SECOND } from "@/features/media-library/components/state/download-throughput-store";

/**
 * Rows only compare against each other if they share one scale, so the domain is resolved once
 * for the whole page and threaded down rather than autoscaled per row.
 */
export function useSharedThroughputDomain(activePeaks: readonly number[]): number {
  // Keyed on the values rather than the array, because the caller rebuilds the array every tick.
  const peakKey = activePeaks.join(",");

  return useMemo(
    () =>
      Math.max(
        SHARED_MAX_FLOOR_BYTES_PER_SECOND,
        peakKey
          .split(",")
          .reduce<number>((highest, peak) => {
            const value = Number(peak);
            return Number.isFinite(value) && value > highest ? value : highest;
          }, 0)
      ),
    [peakKey]
  );
}
