import {
  MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
  MEDIA_JOB_FIXTURE_NETWORK_LOSS_URI,
  MEDIA_JOB_FIXTURE_RECORDING_URI,
  MEDIA_JOB_FIXTURE_RECORDING_COMPRESSED_URI,
  MEDIA_JOB_FIXTURE_RECORDING_STORAGE_PRESSURE_URI,
  MEDIA_JOB_FIXTURE_STORAGE_PRESSURE_URI,
  MEDIA_JOB_HTTP_RANGE_PROOF_URI,
  type MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobilePressRing,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";

import { mediaJobPhaseLabel } from "../utils/media-job-labels";

const fixtureUris = [
  MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
  MEDIA_JOB_HTTP_RANGE_PROOF_URI,
  MEDIA_JOB_FIXTURE_NETWORK_LOSS_URI,
  MEDIA_JOB_FIXTURE_RECORDING_URI,
  MEDIA_JOB_FIXTURE_RECORDING_COMPRESSED_URI,
  MEDIA_JOB_FIXTURE_RECORDING_STORAGE_PRESSURE_URI,
  MEDIA_JOB_FIXTURE_STORAGE_PRESSURE_URI,
] as const;

export function MediaJobsDiagnosticsPanel({
  busy = false,
  jobs,
  onOpenJob,
  onRecover,
  onStartDownload,
  onStartHttpRange,
  onStartNetworkLoss,
  onStartRecording,
  onStartCompressedRecording,
  onStartRecordingStoragePressure,
  onStartStoragePressure,
  status,
}: {
  readonly busy?: boolean;
  readonly jobs: readonly MediaJobSnapshot[];
  readonly onOpenJob: (jobId: string) => void;
  readonly onRecover: () => void;
  readonly onStartDownload: () => void;
  readonly onStartHttpRange: () => void;
  readonly onStartNetworkLoss: () => void;
  readonly onStartRecording: () => void;
  readonly onStartCompressedRecording: () => void;
  readonly onStartRecordingStoragePressure: () => void;
  readonly onStartStoragePressure: () => void;
  readonly status?: string | null;
}) {
  return (
    <MobileStatusPanel testID="media-jobs-diagnostics" tone="info">
      <Text selectable style={mobileType.title}>
        Media Jobs
      </Text>
      <Text selectable style={mobileType.caption} testID="media-jobs-build-stamp">
        M03 Recording · contract 3
      </Text>
      <Text selectable style={mobileType.body}>
        Start a fixture download, compressed four-hour recording cutoff, or
        recording storage-pressure. Activity Jobs show Stop, Open, and
        playable partial recovery.
      </Text>
      {fixtureUris.map((uri) => (
        <Text key={uri} selectable style={mobileType.label}>
          {uri}
        </Text>
      ))}
      {status ? (
        <Text selectable style={mobileType.body} testID="media-jobs-status">
          {status}
        </Text>
      ) : null}
      <MobileButton
        accessibilityLabel="Start fixture download"
        busy={busy}
        onPress={onStartDownload}
        testID="media-jobs-start-download"
        variant="secondary"
      >
        Start fixture download
      </MobileButton>
      <MobileButton
        accessibilityLabel="Start HTTP range proof"
        busy={busy}
        onPress={onStartHttpRange}
        testID="media-jobs-start-http-range"
        variant="secondary"
      >
        Start HTTP range proof
      </MobileButton>
      <MobileButton
        accessibilityLabel="Start network-loss fixture"
        busy={busy}
        onPress={onStartNetworkLoss}
        testID="media-jobs-start-network-loss"
        variant="secondary"
      >
        Start network-loss fixture
      </MobileButton>
      <MobileButton
        accessibilityLabel="Start fixture recording"
        busy={busy}
        onPress={onStartRecording}
        testID="media-jobs-start-recording"
        variant="secondary"
      >
        Start fixture recording
      </MobileButton>
      <MobileButton
        accessibilityLabel="Start compressed four-hour cutoff"
        busy={busy}
        onPress={onStartCompressedRecording}
        testID="media-jobs-start-compressed-recording"
        variant="secondary"
      >
        Start compressed four-hour cutoff
      </MobileButton>
      <MobileButton
        accessibilityLabel="Start recording storage pressure"
        busy={busy}
        onPress={onStartRecordingStoragePressure}
        testID="media-jobs-start-recording-storage-pressure"
        variant="secondary"
      >
        Start recording storage-pressure
      </MobileButton>
      <MobileButton
        accessibilityLabel="Start storage pressure fixture"
        busy={busy}
        onPress={onStartStoragePressure}
        testID="media-jobs-start-storage-pressure"
        variant="secondary"
      >
        Start storage-pressure fixture
      </MobileButton>
      <MobileButton
        accessibilityLabel="Recover Media Jobs"
        busy={busy}
        onPress={onRecover}
        testID="media-jobs-recover"
        variant="primary"
      >
        Recover Media Jobs
      </MobileButton>
      {jobs.map((job) => (
        <Pressable
          accessibilityLabel={`Open ${job.intent.kind} ${job.intent.jobId}`}
          accessibilityRole="button"
          key={job.intent.jobId}
          onPress={() => onOpenJob(job.intent.jobId)}
          style={({ pressed }) => [styles.job, pressed ? styles.jobPressed : null]}
          testID={`media-jobs-open-${job.intent.jobId}`}
        >
          <Text selectable style={mobileType.title}>
            {job.intent.kind} · {mediaJobPhaseLabel(job.phase)}
          </Text>
          <Text selectable style={mobileType.label}>
            {job.intent.jobId}
          </Text>
        </Pressable>
      ))}
    </MobileStatusPanel>
  );
}

const styles = StyleSheet.create({
  job: {
    ...mobilePressRing.rest,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    minHeight: mobileSizing.minimumTouchTarget,
    padding: mobileSpacing.small,
  },
  jobPressed: {
    ...mobilePressRing.pressed,
  },
});
