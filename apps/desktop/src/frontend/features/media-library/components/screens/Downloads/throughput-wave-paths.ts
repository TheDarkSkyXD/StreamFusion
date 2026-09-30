import type { ThroughputSample } from "@/features/media-library/components/state/download-throughput-store";
import { THROUGHPUT_RING_CAPACITY } from "@/features/media-library/components/state/download-throughput-store";

export const THROUGHPUT_WAVE_WIDTH = 140;
export const THROUGHPUT_WAVE_BASELINE = 28;
const THROUGHPUT_WAVE_AMPLITUDE = 26;

export interface ThroughputWavePath {
  readonly line: string;
  readonly area: string;
}

export function throughputPointY(value: number, maximum: number): number {
  return THROUGHPUT_WAVE_BASELINE - (value / Math.max(1, maximum)) * THROUGHPUT_WAVE_AMPLITUDE;
}

/**
 * The wave grows leftward from "now" so x never rescales as samples append, and the area closes
 * onto the zero baseline because a filled area that starts above zero misreads its magnitude.
 */
export function throughputWavePaths({
  samples,
  maximum,
  capacity = THROUGHPUT_RING_CAPACITY,
}: {
  readonly samples: readonly ThroughputSample[];
  readonly maximum: number;
  readonly capacity?: number;
}): ThroughputWavePath | null {
  const retained = samples.length > capacity ? samples.slice(samples.length - capacity) : samples;
  if (retained.length < 2) return null;

  const span = Math.max(1, capacity - 1);
  const offset = capacity - retained.length;
  let line = "";
  let firstX = 0;
  let lastX = 0;
  let lastY = 0;

  retained.forEach((sample, index) => {
    const x = ((index + offset) / span) * THROUGHPUT_WAVE_WIDTH;
    const y = throughputPointY(sample.bytesPerSecond, maximum);
    if (index === 0) {
      firstX = x;
      line = `M ${x} ${y}`;
    } else {
      const midpointX = (lastX + x) / 2;
      line += ` C ${midpointX} ${lastY} ${midpointX} ${y} ${x} ${y}`;
    }
    lastX = x;
    lastY = y;
  });

  return {
    line,
    area: `${line} L ${lastX} ${THROUGHPUT_WAVE_BASELINE} L ${firstX} ${THROUGHPUT_WAVE_BASELINE} Z`,
  };
}
