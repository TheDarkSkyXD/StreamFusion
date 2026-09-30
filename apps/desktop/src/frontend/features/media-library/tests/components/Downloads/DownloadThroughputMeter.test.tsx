import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DownloadThroughputMeter } from "@/features/media-library/components/screens/Downloads/DownloadThroughputMeter";
import {
  _resetDownloadThroughputStoreForTests,
  type ThroughputPhase,
  type ThroughputSeries,
  useDownloadThroughputStore,
} from "@/features/media-library/components/state/download-throughput-store";
import type { DownloadJob } from "@shared/download-types";
import { renderWithProviders, screen } from "../../../../../../../tests/test-utils";
import { act } from "@testing-library/react";

const MIB = 1024 * 1024;
const EM_DASH = "—";
const NBSP = " ";
const DOWNLOAD_RATE_TITLE = "Download rate";
const WRITE_RATE_TITLE = "Write rate";

function downloadJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: "vod-1",
    kind: "video",
    platform: "twitch",
    sourceId: "123",
    title: "Friday Night Finals",
    channelName: "speedrunpro",
    status: "downloading",
    progress: { percent: 42, transferredBytes: 42 * MIB, totalBytes: 100 * MIB },
    destinationPath: "D:\\Videos\\Friday Night Finals.mp4",
    thumbnailUrl: null,
    createdAt: "2026-07-31T12:00:00.000Z",
    updatedAt: "2026-07-31T12:01:00.000Z",
    ...overrides,
  };
}

function series(overrides: Partial<ThroughputSeries> = {}): ThroughputSeries {
  return {
    jobId: "vod-1",
    phase: "active" as ThroughputPhase,
    samples: [
      { atMs: 1_000, bytesPerSecond: 2 * MIB },
      { atMs: 1_500, bytesPerSecond: 3 * MIB },
    ],
    smoothedBytesPerSecond: 3 * MIB,
    peakBytesPerSecond: 3 * MIB,
    averageBytesPerSecond: 4 * MIB,
    ...overrides,
  };
}

function seed(jobId: string, value: ThroughputSeries): void {
  useDownloadThroughputStore.setState({
    seriesByJobId: { ...useDownloadThroughputStore.getState().seriesByJobId, [jobId]: value },
  });
}

function readout(): string {
  const value = screen.getByTitle(DOWNLOAD_RATE_TITLE);
  return value.textContent ?? "";
}

beforeEach(() => {
  _resetDownloadThroughputStoreForTests();
});

afterEach(() => {
  _resetDownloadThroughputStoreForTests();
});

// Guards: a row with nothing measured shows a dash instead of a fabricated zero.
// Guards: an active row reports the smoothed rate and must not announce it on every tick.
// Guards: a stalled row keeps its last measured value instead of blanking.
// Guards: a finished row reports the average it can actually compute and dims the wave.
// Guards: ffmpeg rows must be labelled as a write rate rather than a network rate.
// Guards: two rows in one list must not share a gradient id, which breaks url(#...) on reorder.
describe("DownloadThroughputMeter", () => {
  it("renders a dash and no wave when nothing has been measured", () => {
    renderWithProviders(
      <DownloadThroughputMeter
        job={downloadJob()}
        sharedMaximum={64 * MIB}
        statusTextClassName="text-[var(--color-primary)]"
      />
    );

    expect(readout()).toBe(EM_DASH);
    expect(screen.getByTitle(DOWNLOAD_RATE_TITLE)).toHaveClass(
      "text-[var(--color-foreground-muted)]"
    );
    expect(document.querySelector("svg path")).toBeNull();
  });

  it("renders the smoothed rate and the wave for an active row", () => {
    seed("vod-1", series());
    const view = renderWithProviders(
      <DownloadThroughputMeter
        job={downloadJob()}
        sharedMaximum={64 * MIB}
        statusTextClassName="text-[var(--color-primary)]"
      />
    );

    expect(readout()).toBe(`3.0${NBSP}MiB/s`);
    expect(document.querySelector("svg path")?.getAttribute("d")).toContain("M ");
    expect(document.querySelector("[aria-live]")).toBeNull();

    act(() => seed("vod-1", series({ samples: [{ atMs: 1_000, bytesPerSecond: 2 * MIB }] })));
    expect(readout()).toBe(`2.0${NBSP}MiB/s`);
    view.unmount();
  });

  it("keeps the last measured value visible while stalled", () => {
    seed("vod-1", series({ phase: "stalled", smoothedBytesPerSecond: 16 * 1024 }));
    renderWithProviders(
      <DownloadThroughputMeter
        job={downloadJob()}
        sharedMaximum={64 * MIB}
        statusTextClassName="text-[var(--color-primary)]"
      />
    );

    expect(screen.getByTitle("Stalled").textContent).toBe(`3.0${NBSP}MiB/s`);
    expect(document.querySelector("svg path")).not.toBeNull();
  });

  it("reports the average and dims the wave for a finished row", () => {
    seed("vod-1", series({ phase: "complete" }));
    const view = renderWithProviders(
      <DownloadThroughputMeter
        job={downloadJob({ status: "completed" })}
        sharedMaximum={64 * MIB}
        statusTextClassName="text-emerald-300"
      />
    );

    expect(readout()).toBe(`Average 4.0${NBSP}MiB/s`);
    expect(document.querySelector("svg")).toHaveClass("opacity-50");

    act(() => seed("vod-1", series({ phase: "complete", averageBytesPerSecond: null })));
    expect(readout()).toBe(EM_DASH);
    view.unmount();
  });

  it("labels a write-rate row by what its byte counter measures", () => {
    seed("vod-1", series());
    renderWithProviders(
      <DownloadThroughputMeter
        job={downloadJob({ byteSource: "output-file" })}
        sharedMaximum={64 * MIB}
        statusTextClassName="text-[var(--color-primary)]"
      />
    );

    expect(screen.getByText(WRITE_RATE_TITLE)).toBeInTheDocument();
    expect(screen.getByTitle(WRITE_RATE_TITLE).textContent).toBe(`3.0${NBSP}MiB/s`);
    expect(screen.queryByTitle(DOWNLOAD_RATE_TITLE)).toBeNull();
  });

  it("gives each row its own gradient id", () => {
    seed("vod-1", series());
    seed("vod-2", series({ jobId: "vod-2" }));
    renderWithProviders(
      <>
        <DownloadThroughputMeter
          job={downloadJob()}
          sharedMaximum={64 * MIB}
          statusTextClassName="text-[var(--color-primary)]"
        />
        <DownloadThroughputMeter
          job={downloadJob({ id: "vod-2", title: "Championship VOD" })}
          sharedMaximum={64 * MIB}
          statusTextClassName="text-[var(--color-primary)]"
        />
      </>
    );

    const ids = Array.from(document.querySelectorAll("linearGradient")).map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const fills = Array.from(document.querySelectorAll("path")).map((node) =>
      node.getAttribute("fill")
    );
    expect(new Set(fills).size).toBe(2);
  });

  it("renders a placeholder row instead of failing when no series exists yet", () => {
    renderWithProviders(
      <DownloadThroughputMeter
        job={downloadJob({ id: "queued-1", status: "queued" })}
        sharedMaximum={64 * MIB}
        statusTextClassName="text-[var(--color-foreground-secondary)]"
      />
    );

    expect(readout()).toBe(EM_DASH);
    expect(document.querySelector("svg")).toHaveAttribute("viewBox", "0 0 140 28");
    expect(document.querySelector("svg path")).toBeNull();
  });
});
