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

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
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
    <View style={styles.panel} testID="media-jobs-diagnostics">
      <Text selectable style={styles.label}>
        MEDIA JOB ENGINE
      </Text>
      <Text selectable style={styles.meta} testID="media-jobs-build-stamp">
        M03 Recording · contract 3
      </Text>
      <Text selectable style={styles.body}>
        Start a fixture download, compressed four-hour recording cutoff, or
        recording storage-pressure. Activity Jobs show Stop, Open, and
        playable partial recovery.
      </Text>
      {fixtureUris.map((uri) => (
        <Text key={uri} selectable style={styles.meta}>
          {uri}
        </Text>
      ))}
      {status ? (
        <Text selectable style={styles.body} testID="media-jobs-status">
          {status}
        </Text>
      ) : null}
      <Action
        busy={busy}
        label="Start fixture download"
        onPress={onStartDownload}
        testID="media-jobs-start-download"
      />
      <Action
        busy={busy}
        label="Start HTTP range proof"
        onPress={onStartHttpRange}
        testID="media-jobs-start-http-range"
      />
      <Action
        busy={busy}
        label="Start network-loss fixture"
        onPress={onStartNetworkLoss}
        testID="media-jobs-start-network-loss"
      />
      <Action
        busy={busy}
        label="Start fixture recording"
        onPress={onStartRecording}
        testID="media-jobs-start-recording"
      />
      <Action
        busy={busy}
        label="Start compressed four-hour cutoff"
        onPress={onStartCompressedRecording}
        testID="media-jobs-start-compressed-recording"
      />
      <Action
        accessibilityLabel="Start recording storage pressure"
        busy={busy}
        label="Start recording storage-pressure"
        onPress={onStartRecordingStoragePressure}
        testID="media-jobs-start-recording-storage-pressure"
      />
      <Action
        accessibilityLabel="Start storage pressure fixture"
        busy={busy}
        label="Start storage-pressure fixture"
        onPress={onStartStoragePressure}
        testID="media-jobs-start-storage-pressure"
      />
      <Action
        busy={busy}
        label="Recover Media Jobs"
        onPress={onRecover}
        testID="media-jobs-recover"
      />
      {jobs.map((job) => (
        <Pressable
          accessibilityLabel={`Open ${job.intent.kind} ${job.intent.jobId}`}
          accessibilityRole="button"
          key={job.intent.jobId}
          onPress={() => onOpenJob(job.intent.jobId)}
          style={styles.job}
          testID={`media-jobs-open-${job.intent.jobId}`}
        >
          <Text selectable style={styles.buttonLabel}>
            {job.intent.kind} · {mediaJobPhaseLabel(job.phase)}
          </Text>
          <Text selectable style={styles.meta}>
            {job.intent.jobId}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function Action({
  accessibilityLabel,
  busy,
  label,
  onPress,
  testID,
}: {
  readonly accessibilityLabel?: string;
  readonly busy: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={styles.button}
      testID={testID}
    >
      <Text selectable style={styles.buttonLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { color: mobileColors.textSecondary, lineHeight: 20 },
  button: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  buttonLabel: { color: mobileColors.textPrimary, fontWeight: "700" },
  job: {
    backgroundColor: mobileColors.surfaceMuted,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    minHeight: mobileSizing.minimumTouchTarget,
    padding: mobileSpacing.small,
  },
  label: { color: mobileColors.textSecondary, fontSize: 12, fontWeight: "700" },
  meta: { color: mobileColors.textCategory, fontSize: 12 },
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
});
