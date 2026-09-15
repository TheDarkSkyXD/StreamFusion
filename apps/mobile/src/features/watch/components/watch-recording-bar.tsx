import type {
  MediaJobCommandName,
  MediaJobPhase,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { validCommands } from "@streamfusion/core/media-jobs";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import {
  mediaJobCommandLabel,
  mediaJobDisplayedStatus,
  mediaJobPhaseLabel,
} from "@mobile/features/media-jobs/utils/media-job-labels";

import type { WatchRecordingEligibility } from "../domain/watch-recording";

const jobCommands: readonly Exclude<MediaJobCommandName, "start">[] = [
  "pause",
  "resume",
  "finalize",
  "retry",
];

export function WatchRecordingBar({
  busy = false,
  eligibility,
  job,
  onCommand,
  onDelete,
  onExport,
  onOpenArtifact,
  onStart,
  status,
}: {
  readonly busy?: boolean;
  readonly eligibility: WatchRecordingEligibility;
  readonly job: MediaJobSnapshot | null;
  readonly onCommand: (command: MediaJobCommandName) => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
  readonly onOpenArtifact: () => void;
  readonly onStart: () => void;
  readonly status?: string | null;
}) {
  if (eligibility.kind === "hidden") return null;
  if (eligibility.kind === "unsupported") {
    return (
      <View style={styles.panel} testID="watch-recording">
        <Text selectable style={styles.body} testID="watch-recording-unsupported">
          {eligibility.reason}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.panel} testID="watch-recording">
      {job ? (
        <ActiveRecording
          busy={busy}
          job={job}
          onCommand={onCommand}
          onDelete={onDelete}
          onExport={onExport}
          onOpenArtifact={onOpenArtifact}
          status={status}
        />
      ) : (
        <Action
          busy={busy}
          label={eligibility.label}
          onPress={onStart}
          testID="watch-recording-start"
        />
      )}
    </View>
  );
}

function ActiveRecording({
  busy,
  job,
  onCommand,
  onDelete,
  onExport,
  onOpenArtifact,
  status,
}: {
  readonly busy: boolean;
  readonly job: MediaJobSnapshot;
  readonly onCommand: (command: MediaJobCommandName) => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
  readonly onOpenArtifact: () => void;
  readonly status?: string | null;
}) {
  const commands = jobCommands.filter((command) =>
    validCommands(job.phase).includes(command),
  );
  return (
    <>
      <Text selectable style={styles.body} testID="watch-recording-phase">
        {mediaJobPhaseLabel(job.phase)}
      </Text>
      <Text selectable style={styles.body} testID="watch-recording-status">
        {mediaJobDisplayedStatus(status, job.statusMessage)}
      </Text>
      <Text selectable style={styles.body} testID="watch-recording-progress">
        {progressLabel(job)}
      </Text>
      <View style={styles.actions}>
        {commands.map((command) => (
          <Action
            busy={busy}
            key={command}
            label={mediaJobCommandLabel(command, "recording")}
            onPress={() => onCommand(command)}
            testID={`watch-recording-command-${command}`}
          />
        ))}
        {job.phase === "completed" ? (
          <>
            <Action
              busy={busy}
              label="Open"
              onPress={onOpenArtifact}
              testID="watch-recording-open"
            />
            <Action
              busy={busy}
              label="Export"
              onPress={onExport}
              testID="watch-recording-export"
            />
          </>
        ) : null}
        {canDeleteJob(job.phase) ? (
          <Action
            busy={busy}
            label="Delete"
            onPress={onDelete}
            testID="watch-recording-delete"
          />
        ) : null}
      </View>
    </>
  );
}

function Action({
  busy,
  label,
  onPress,
  testID,
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
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

function progressLabel(job: MediaJobSnapshot): string {
  const durationMs = job.checkpoint?.durationMs ?? 0;
  const bytes = job.progress.transferredBytes;
  if (durationMs > 0) {
    return `${formatDuration(durationMs)} · ${bytes} bytes`;
  }
  return `${bytes} bytes`;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function canDeleteJob(phase: MediaJobPhase): boolean {
  return (
    phase === "completed" ||
    phase === "canceled" ||
    phase === "failed-retryable" ||
    phase === "failed-terminal"
  );
}

const styles = StyleSheet.create({
  actions: { gap: mobileSpacing.small },
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
  panel: { gap: mobileSpacing.small },
});
