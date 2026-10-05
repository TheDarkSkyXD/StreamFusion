import { useState } from "react";
import type { MediaJobSnapshot } from "@streamfusion/core/media-jobs";
import {
  measuredTransferRate,
  transferSample,
  transferRemainingSeconds,
  type TransferSample,
} from "../domain/transfer-observation";
export function useTransferObservation(job: MediaJobSnapshot) {
  const current = transferSample(job);
  const [sample, setSample] = useState<{
    readonly jobId: string;
    readonly previous: TransferSample | null;
    readonly rate: number | null;
  }>(() => ({ jobId: job.intent.jobId, previous: current, rate: null }));
  if (
    sample.jobId !== job.intent.jobId ||
    sample.previous?.measuredAt !== current?.measuredAt ||
    sample.previous?.bytes !== current?.bytes ||
    sample.previous?.generation !== current?.generation
  ) {
    setSample({
      jobId: job.intent.jobId,
      previous: current,
      rate:
        sample.jobId === job.intent.jobId
          ? measuredTransferRate(sample.previous, current)
          : null,
    });
  }
  const rate =
    job.phase === "running" && sample.jobId === job.intent.jobId
      ? sample.rate
      : null;
  return {
    bytesPerSecond: rate,
    remainingSeconds: transferRemainingSeconds(job, rate),
  };
}
