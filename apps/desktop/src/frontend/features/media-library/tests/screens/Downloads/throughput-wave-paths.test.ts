import { describe, expect, it } from "vitest";

import type { ThroughputSample } from "@/features/media-library/components/state/download-throughput-store";
import { THROUGHPUT_RING_CAPACITY } from "@/features/media-library/components/state/download-throughput-store";
import {
  THROUGHPUT_WAVE_BASELINE,
  THROUGHPUT_WAVE_WIDTH,
  throughputPointY,
  throughputWavePaths,
} from "@/features/media-library/components/screens/Downloads/throughput-wave-paths";

const MIB = 1024 * 1024;

function sample(index: number, bytesPerSecond: number): ThroughputSample {
  return { atMs: index * 500, bytesPerSecond };
}

// Guards: a filled area that does not start and end on the zero baseline misreads its own magnitude.
// Guards: interpolation must stay inside the sampled endpoints so smoothing invents no spike.
// Guards: a full ring must keep exactly one window of samples and drop the oldest instead of rescaling.
// Guards: fewer than two samples cannot describe a wave and must render nothing.
describe("download throughput wave paths", () => {
  it("closes the filled area onto the zero baseline", () => {
    const path = throughputWavePaths({
      samples: [sample(0, 1 * MIB), sample(1, 4 * MIB), sample(2, 2 * MIB)],
      maximum: 8 * MIB,
    });
    expect(path).not.toBeNull();
    expect(path?.area.startsWith(path?.line ?? "")).toBe(true);
    expect(path?.area).toContain(` L ${THROUGHPUT_WAVE_WIDTH} ${THROUGHPUT_WAVE_BASELINE} L `);
    expect(path?.area.endsWith(`${THROUGHPUT_WAVE_BASELINE} Z`)).toBe(true);
    expect(throughputPointY(0, 8 * MIB)).toBe(THROUGHPUT_WAVE_BASELINE);
    expect(throughputPointY(8 * MIB, 8 * MIB)).toBeLessThan(THROUGHPUT_WAVE_BASELINE);
  });

  it("keeps every interpolated segment within its sampled endpoints", () => {
    const peaks = [0, 8, 3, 3, 7, 0].map((mib, index) => sample(index, mib * MIB));
    const path = throughputWavePaths({ samples: peaks, maximum: 8 * MIB });
    const segments = path?.line.split(" C ").slice(1) ?? [];
    expect(segments).toHaveLength(peaks.length - 1);

    segments.forEach((segment, index) => {
      const [controlX1, controlY1, controlX2, controlY2, x, y] = segment.split(" ").map(Number);
      const from = throughputPointY(peaks[index]?.bytesPerSecond ?? 0, 8 * MIB);
      const to = throughputPointY(peaks[index + 1]?.bytesPerSecond ?? 0, 8 * MIB);
      expect(y).toBe(to);
      expect(x).toBeGreaterThan(controlX2 ?? 0);
      expect(controlX2).toBeGreaterThanOrEqual(controlX1 ?? 0);
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        const interpolated =
          (1 - t) ** 3 * from +
          3 * (1 - t) ** 2 * t * (controlY1 ?? 0) +
          3 * (1 - t) * t ** 2 * (controlY2 ?? 0) +
          t ** 3 * (y ?? 0);
        expect(interpolated).toBeGreaterThanOrEqual(Math.min(from, to) - 1e-10);
        expect(interpolated).toBeLessThanOrEqual(Math.max(from, to) + 1e-10);
      }
    });
  });

  it("draws a full ring from the oldest retained sample and drops what falls out", () => {
    const samples = Array.from({ length: THROUGHPUT_RING_CAPACITY + 6 }, (_, index) =>
      sample(index, (index + 1) * MIB)
    );
    const path = throughputWavePaths({ samples, maximum: 100 * MIB });
    const retained = samples.slice(-THROUGHPUT_RING_CAPACITY);

    expect(retained).toHaveLength(THROUGHPUT_RING_CAPACITY);
    expect(path?.line.split(" C ").length).toBe(THROUGHPUT_RING_CAPACITY);
    expect(
      path?.line.startsWith(`M 0 ${throughputPointY(retained[0]!.bytesPerSecond, 100 * MIB)}`)
    ).toBe(true);
    expect(
      path?.line.endsWith(`140 ${throughputPointY(retained.at(-1)!.bytesPerSecond, 100 * MIB)}`)
    ).toBe(true);
  });

  it("grows leftward from now so a partial window keeps its right edge", () => {
    const samples = [sample(0, 1 * MIB), sample(1, 2 * MIB)];
    const path = throughputWavePaths({ samples, maximum: 4 * MIB });
    const firstX =
      ((THROUGHPUT_RING_CAPACITY - 2) / (THROUGHPUT_RING_CAPACITY - 1)) * THROUGHPUT_WAVE_WIDTH;
    const from = throughputPointY(1 * MIB, 4 * MIB);
    const to = throughputPointY(2 * MIB, 4 * MIB);

    expect(path?.line).toBe(
      `M ${firstX} ${from} C ${(firstX + THROUGHPUT_WAVE_WIDTH) / 2} ${from} ${
        (firstX + THROUGHPUT_WAVE_WIDTH) / 2
      } ${to} ${THROUGHPUT_WAVE_WIDTH} ${to}`
    );
  });

  it("returns nothing until two samples exist", () => {
    expect(throughputWavePaths({ samples: [], maximum: 4 * MIB })).toBeNull();
    expect(throughputWavePaths({ samples: [sample(0, 1 * MIB)], maximum: 4 * MIB })).toBeNull();
  });
});
