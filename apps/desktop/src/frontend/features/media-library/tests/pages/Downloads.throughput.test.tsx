import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DownloadsPage } from "@/features/media-library/components/screens/Downloads";
import { THROUGHPUT_WAVE_BASELINE } from "@/features/media-library/components/screens/Downloads/throughput-wave-paths";
import { useSharedThroughputDomain } from "@/features/media-library/components/hooks/use-shared-throughput-domain";
import {
  _resetDownloadThroughputStoreForTests,
  SHARED_MAX_FLOOR_BYTES_PER_SECOND,
} from "@/features/media-library/components/state/download-throughput-store";
import type { DownloadJob, DownloadQueueSnapshot } from "@shared/download-types";
import {
  installElectronAPIMock,
  renderWithProviders,
  screen,
} from "../../../../../../tests/test-utils";

const MIB = 1024 * 1024;
const START_MS = Date.parse("2026-07-31T12:00:00.000Z");
const WAVE_VIEW_BOX = "0 0 140 28";

function downloadJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "row-a",
    kind: "video",
    platform: "twitch",
    sourceId: "123",
    title: "Row A",
    channelName: "speedrunpro",
    status: "downloading",
    progress: { percent: null, transferredBytes: 0, totalBytes: null },
    destinationPath: "D:\\Videos\\Row A.mp4",
    thumbnailUrl: null,
    createdAt: "2026-07-31T12:00:00.000Z",
    updatedAt: "2026-07-31T12:00:00.000Z",
    ...overrides,
  };
}

function wavePathOf(title: string): SVGPathElement | null {
  const row = screen.getByText(title).closest("article");
  const wave = Array.from(row?.querySelectorAll("svg") ?? []).find(
    (node) => node.getAttribute("viewBox") === WAVE_VIEW_BOX
  );
  return wave?.querySelector("path") ?? null;
}

function peakHeight(title: string): number {
  const ys = [
    ...(wavePathOf(title)?.getAttribute("d") ?? "").matchAll(/[MC] [\d.]+ (-?[\d.]+)/g),
  ].map((match) => Number(match[1]));
  expect(ys.length).toBeGreaterThan(0);
  return Math.max(...ys.map((y) => THROUGHPUT_WAVE_BASELINE - y));
}

let downloads: ReturnType<typeof installElectronAPIMock>["downloads"];
let pushQueue: ((snapshot: DownloadQueueSnapshot) => void) | undefined;

function advanceTo(jobs: DownloadJob[], atMs: number): void {
  vi.setSystemTime(atMs);
  act(() => {
    pushQueue?.({ jobs });
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START_MS);
  _resetDownloadThroughputStoreForTests();
  const api = installElectronAPIMock();
  downloads = api.downloads;
  downloads.getQueue = vi.fn(async () => ({ jobs: [] }));
  vi.mocked(downloads.onQueueChanged).mockImplementation((callback) => {
    pushQueue = callback;
    return vi.fn();
  });
  pushQueue = undefined;
});

afterEach(() => {
  _resetDownloadThroughputStoreForTests();
  vi.useRealTimers();
});

// Guards: rows are only comparable against each other when the page resolves one scale over every visible row.
// Guards: the scale must follow recorded peaks so it does not breathe while the user compares rows.
// Guards: a finished row must stop moving the scale for the rest of the session.
// Guards: a page with nothing measured must fall back to the floor instead of a zero or pegged scale.
describe("download throughput shared domain", () => {
  it("renders every row against the highest recorded peak rather than its current rate", async () => {
    const rowA = downloadJob({ id: "row-a", title: "Row A" });
    const rowB = downloadJob({ id: "row-b", title: "Row B" });
    vi.mocked(downloads.getQueue).mockResolvedValue({ jobs: [rowA, rowB] });

    renderWithProviders(<DownloadsPage />);
    await screen.findByText("Row A");

    let aBytes = 0;
    let bBytes = 0;
    for (let bucket = 1; bucket <= 24; bucket += 1) {
      aBytes += bucket <= 4 ? 4 * MIB : 0.5 * MIB;
      bBytes += 2 * MIB;
      advanceTo(
        [
          downloadJob({
            ...rowA,
            progress: { percent: null, transferredBytes: aBytes, totalBytes: null },
          }),
          downloadJob({
            ...rowB,
            progress: { percent: null, transferredBytes: bBytes, totalBytes: null },
          }),
        ],
        START_MS + bucket * 500
      );
    }

    const amplitude = THROUGHPUT_WAVE_BASELINE - 2;
    expect(peakHeight("Row A")).toBeCloseTo(amplitude, 1);
    expect(peakHeight("Row B")).toBeCloseTo(amplitude / 2, 1);
  });

  it("stops counting a row toward the scale on the tick it completes", async () => {
    const rowA = downloadJob({ id: "row-a", title: "Row A" });
    const rowB = downloadJob({ id: "row-b", title: "Row B" });
    vi.mocked(downloads.getQueue).mockResolvedValue({ jobs: [rowA, rowB] });

    renderWithProviders(<DownloadsPage />);
    await screen.findByText("Row A");

    let aBytes = 0;
    let bBytes = 0;
    for (let bucket = 1; bucket <= 4; bucket += 1) {
      aBytes += 4 * MIB;
      bBytes += 2 * MIB;
      advanceTo(
        [
          downloadJob({
            ...rowA,
            progress: { percent: null, transferredBytes: aBytes, totalBytes: null },
          }),
          downloadJob({
            ...rowB,
            progress: { percent: null, transferredBytes: bBytes, totalBytes: null },
          }),
        ],
        START_MS + bucket * 500
      );
    }
    const sharedBefore = peakHeight("Row B");

    advanceTo(
      [
        downloadJob({
          ...rowA,
          status: "completed",
          progress: { percent: 100, transferredBytes: aBytes, totalBytes: aBytes },
        }),
        downloadJob({
          ...rowB,
          progress: { percent: null, transferredBytes: bBytes, totalBytes: null },
        }),
      ],
      START_MS + 2500
    );

    expect(peakHeight("Row B")).toBeCloseTo(sharedBefore * 2, 1);
  });

  it("falls back to the floor when no row has recorded a peak", () => {
    const { result } = renderHook(() => useSharedThroughputDomain([0, 0]));
    expect(result.current).toBe(SHARED_MAX_FLOOR_BYTES_PER_SECOND);

    const { result: trickle } = renderHook(() => useSharedThroughputDomain([4 * 1024]));
    expect(trickle.current).toBe(SHARED_MAX_FLOOR_BYTES_PER_SECOND);

    const { result: scaled } = renderHook(() => useSharedThroughputDomain([8 * MIB]));
    expect(scaled.current).toBe(8 * MIB);
  });
});
