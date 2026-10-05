import type { MediaJobSnapshot } from "@streamfusion/core/media-jobs";
export type TransferSample = {
  readonly bytes: number;
  readonly generation: number;
  readonly measuredAt: number;
};
export function transferSample(job: MediaJobSnapshot): TransferSample | null {
  return job.checkpoint
    ? {
        bytes: job.progress.transferredBytes,
        generation: job.checkpoint.generation,
        measuredAt: Date.parse(job.checkpoint.updatedAt),
      }
    : null;
}
export function measuredTransferRate(
  previous: TransferSample | null,
  current: TransferSample | null,
): number | null {
  if (
    !previous ||
    !current ||
    current.generation !== previous.generation ||
    current.measuredAt <= previous.measuredAt ||
    current.bytes < previous.bytes
  )
    return null;
  return (
    ((current.bytes - previous.bytes) * 1000) /
    (current.measuredAt - previous.measuredAt)
  );
}
export function transferRemainingSeconds(
  job: MediaJobSnapshot,
  bytesPerSecond: number | null,
): number | null {
  const total = job.progress.totalBytes;
  if (
    job.phase !== "running" ||
    total === null ||
    bytesPerSecond === null ||
    bytesPerSecond <= 0
  )
    return null;
  return Math.max(0, (total - job.progress.transferredBytes) / bytesPerSecond);
}
