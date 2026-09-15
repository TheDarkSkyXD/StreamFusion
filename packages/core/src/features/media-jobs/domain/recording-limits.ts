export const MEDIA_JOB_RECORDING_CUTOFF_MS = 4 * 60 * 60 * 1000;
export const MEDIA_JOB_RECORDING_WARNING_LEAD_MS = 10 * 60 * 1000;
export const MEDIA_JOB_COMPRESSED_RECORDING_CUTOFF_MS = 12_000;
export const MEDIA_JOB_COMPRESSED_RECORDING_WARNING_MS = 8_000;

export const MEDIA_JOB_FIXTURE_RECORDING_COMPRESSED_URI =
  "streamfusion-fixture://recording?cutoff=compressed";
export const MEDIA_JOB_FIXTURE_RECORDING_STORAGE_PRESSURE_URI =
  "streamfusion-fixture://recording?storage-pressure";

export const MEDIA_JOB_RECORDING_WARNING_STATUS =
  "Recording will stop at the four-hour limit.";
export const MEDIA_JOB_RECORDING_CUTOFF_STATUS =
  "Stopped at the four-hour limit. Partial recording saved.";
export const MEDIA_JOB_RECORDING_STOPPED_STATUS =
  "Stopped. Partial recording saved.";

const CUTOFF_MS_PATTERN = /[?&]cutoffMs=(\d+)/u;

export function recordingCutoffMs(sourceUri: string): number {
  const explicit = CUTOFF_MS_PATTERN.exec(sourceUri);
  if (explicit) return Number(explicit[1]);
  if (sourceUri.includes("cutoff=compressed")) {
    return MEDIA_JOB_COMPRESSED_RECORDING_CUTOFF_MS;
  }
  return MEDIA_JOB_RECORDING_CUTOFF_MS;
}

export function recordingWarningMs(sourceUri: string): number {
  if (
    sourceUri.includes("cutoff=compressed") &&
    !CUTOFF_MS_PATTERN.test(sourceUri)
  ) {
    return MEDIA_JOB_COMPRESSED_RECORDING_WARNING_MS;
  }
  const cutoff = recordingCutoffMs(sourceUri);
  if (CUTOFF_MS_PATTERN.test(sourceUri)) {
    return Math.max(0, Math.floor((cutoff * 2) / 3));
  }
  return cutoff - MEDIA_JOB_RECORDING_WARNING_LEAD_MS;
}

export function recordingStatusForElapsed(
  sourceUri: string,
  elapsedMs: number,
): string {
  if (elapsedMs >= recordingCutoffMs(sourceUri)) {
    return MEDIA_JOB_RECORDING_CUTOFF_STATUS;
  }
  if (elapsedMs >= recordingWarningMs(sourceUri)) {
    return MEDIA_JOB_RECORDING_WARNING_STATUS;
  }
  return "Running";
}
