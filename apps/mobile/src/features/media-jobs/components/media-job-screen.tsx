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
} from "../utils/media-job-labels";

const commandOrder: readonly Exclude<MediaJobCommandName, "start">[] = [
  "pause",
  "resume",
  "finalize",
  "retry",
  "cancel",
  "recover",
];

export function MediaJobScreen({
  busy = false,
  onCommand,
  onDelete,
  onExport,
  onOpen,
  snapshot,
  status,
}: {
  readonly busy?: boolean;
  readonly onCommand: (command: MediaJobCommandName) => void;
  readonly onDelete?: () => void;
  readonly onExport?: () => void;
  readonly onOpen?: () => void;
  readonly snapshot: MediaJobSnapshot | null;
  readonly status?: string | null;
}) {
  if (!snapshot) return <MissingJob />;
  return (
    <View style={styles.panel} testID="media-job-detail">
      <Text selectable style={styles.label}>
        MEDIA JOB
      </Text>
      <Text
        accessibilityRole="header"
        selectable
        style={styles.title}
        testID="media-job-title"
      >
        {snapshot.intent.kind === "download" ? "Download" : "Recording"}
      </Text>
      <Text selectable style={styles.body} testID="media-job-phase">
        {mediaJobPhaseLabel(snapshot.phase)}
      </Text>
      <Text selectable style={styles.body} testID="media-job-status">
        {mediaJobDisplayedStatus(status, snapshot.statusMessage)}
      </Text>
      <Text selectable style={styles.body} testID="media-job-progress">
        {progressLabel(snapshot)}
      </Text>
      <Text selectable style={styles.body} testID="media-job-artifact">
        {artifactLabel(snapshot)}
      </Text>
      <Text selectable style={styles.body} testID="media-job-service">
        {serviceLabel(snapshot)}
      </Text>
      <JobActions
        busy={busy}
        onCommand={onCommand}
        onDelete={onDelete}
        onExport={onExport}
        onOpen={onOpen}
        snapshot={snapshot}
      />
    </View>
  );
}

function MissingJob() {
  return (
    <View style={styles.panel} testID="media-job-missing">
      <Text selectable style={styles.label}>
        MEDIA JOB
      </Text>
      <Text selectable style={styles.body}>
        This Media Job is not on the device yet. Recover jobs from Diagnostics
        or start a fixture job.
      </Text>
    </View>
  );
}

function JobActions({
  busy,
  onCommand,
  onDelete,
  onExport,
  onOpen,
  snapshot,
}: {
  readonly busy: boolean;
  readonly onCommand: (command: MediaJobCommandName) => void;
  readonly onDelete?: () => void;
  readonly onExport?: () => void;
  readonly onOpen?: () => void;
  readonly snapshot: MediaJobSnapshot;
}) {
  const commands = commandOrder.filter((command) =>
    validCommands(snapshot.phase).includes(command),
  );
  return (
    <View style={styles.actions}>
      {commands.map((command) => (
        <Action
          busy={busy}
          key={command}
          label={mediaJobCommandLabel(command, snapshot.intent.kind)}
          onPress={() => onCommand(command)}
          testID={`media-job-command-${command}`}
        />
      ))}
      {snapshot.phase === "completed" && onOpen ? (
        <Action busy={busy} label="Open" onPress={onOpen} testID="media-job-open" />
      ) : null}
      {snapshot.phase === "completed" && onExport ? (
        <Action
          busy={busy}
          label="Export"
          onPress={onExport}
          testID="media-job-export"
        />
      ) : null}
      {canDeleteJob(snapshot.phase) && onDelete ? (
        <Action
          busy={busy}
          label="Delete"
          onPress={onDelete}
          testID="media-job-delete"
        />
      ) : null}
    </View>
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

function progressLabel(snapshot: MediaJobSnapshot): string {
  const { totalBytes, transferredBytes } = snapshot.progress;
  if (totalBytes && totalBytes > 0) {
    const percent = Math.min(
      100,
      Math.round((transferredBytes / totalBytes) * 100),
    );
    return `${percent}% · ${transferredBytes} bytes`;
  }
  if (snapshot.artifact.kind === "complete") {
    return `100% · ${transferredBytes} bytes`;
  }
  return `${transferredBytes} bytes`;
}

function artifactLabel(snapshot: MediaJobSnapshot): string {
  if (snapshot.artifact.kind === "none") return "No artifact yet.";
  const qualifier =
    snapshot.artifact.kind === "complete" ? "Complete" : "Partial";
  return `${qualifier} artifact · ${snapshot.artifact.bytes} bytes`;
}

function serviceLabel(snapshot: MediaJobSnapshot): string {
  return snapshot.service.kind === "owned"
    ? "Android service owns this job."
    : "No Android service currently owns this job.";
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
  label: { color: mobileColors.textSecondary, fontSize: 12, fontWeight: "700" },
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  title: { color: mobileColors.textPrimary, fontSize: 22, fontWeight: "700" },
});
