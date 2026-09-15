import {
  MEDIA_JOB_FIXTURE_DOWNLOAD_URI,
  MEDIA_JOB_FIXTURE_NETWORK_LOSS_URI,
  MEDIA_JOB_FIXTURE_RECORDING_URI,
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

export function MediaJobsDiagnosticsPanel({
  busy = false,
  jobs,
  onOpenJob,
  onRecover,
  onStartDownload,
  onStartHttpRange,
  onStartNetworkLoss,
  onStartRecording,
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
  readonly onStartStoragePressure: () => void;
  readonly status?: string | null;
}) {
  return (
    <View style={styles.panel} testID="media-jobs-diagnostics">
      <Text selectable style={styles.label}>
        MEDIA JOB ENGINE
      </Text>
      <Text selectable style={styles.meta} testID="media-jobs-build-stamp">
        M02 Downloads · contract 3
      </Text>
      <Text selectable style={styles.body}>
        Start a fixture download, HTTP range proof, network-loss, or recording.
        Activity Jobs and job details show durable state, export, and delete.
      </Text>
      <Text selectable style={styles.meta}>
        {MEDIA_JOB_FIXTURE_DOWNLOAD_URI}
      </Text>
      <Text selectable style={styles.meta}>
        {MEDIA_JOB_HTTP_RANGE_PROOF_URI}
      </Text>
      <Text selectable style={styles.meta}>
        {MEDIA_JOB_FIXTURE_NETWORK_LOSS_URI}
      </Text>
      <Text selectable style={styles.meta}>
        {MEDIA_JOB_FIXTURE_RECORDING_URI}
      </Text>
      <Text selectable style={styles.meta}>
        {MEDIA_JOB_FIXTURE_STORAGE_PRESSURE_URI}
      </Text>
      {status ? (
        <Text selectable style={styles.body} testID="media-jobs-status">
          {status}
        </Text>
      ) : null}
      <Pressable
        accessibilityLabel="Start fixture download"
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onStartDownload}
        style={styles.button}
        testID="media-jobs-start-download"
      >
        <Text selectable style={styles.buttonLabel}>
          Start fixture download
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Start HTTP range proof"
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onStartHttpRange}
        style={styles.button}
        testID="media-jobs-start-http-range"
      >
        <Text selectable style={styles.buttonLabel}>
          Start HTTP range proof
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Start network-loss fixture"
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onStartNetworkLoss}
        style={styles.button}
        testID="media-jobs-start-network-loss"
      >
        <Text selectable style={styles.buttonLabel}>
          Start network-loss fixture
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Start fixture recording"
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onStartRecording}
        style={styles.button}
        testID="media-jobs-start-recording"
      >
        <Text selectable style={styles.buttonLabel}>
          Start fixture recording
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Start storage pressure fixture"
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onStartStoragePressure}
        style={styles.button}
        testID="media-jobs-start-storage-pressure"
      >
        <Text selectable style={styles.buttonLabel}>
          Start storage-pressure fixture
        </Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Recover Media Jobs"
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onRecover}
        style={styles.button}
        testID="media-jobs-recover"
      >
        <Text selectable style={styles.buttonLabel}>
          Recover Media Jobs
        </Text>
      </Pressable>
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
