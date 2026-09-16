import type {
  MediaJobCommandName,
  MediaJobPhase,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { validCommands } from "@streamfusion/core/media-jobs";
import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import { MobileScreenHeader } from "@mobile/design/screen-header";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";

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
    <View style={styles.screen}>
      <MobileScreenHeader
        summary={mediaJobPhaseLabel(snapshot.phase)}
        title={snapshot.intent.kind === "download" ? "Download" : "Recording"}
      />
      <MobileStatusPanel testID="media-job-detail" tone="info">
      <Text selectable style={mobileType.body} testID="media-job-title">
        {snapshot.intent.kind === "download" ? "Download" : "Recording"}
      </Text>
      <Text selectable style={mobileType.body} testID="media-job-phase">
        {mediaJobPhaseLabel(snapshot.phase)}
      </Text>
      <Text selectable style={mobileType.body} testID="media-job-status">
        {mediaJobDisplayedStatus(status, snapshot.statusMessage)}
      </Text>
      <Text selectable style={mobileType.body} testID="media-job-progress">
        {progressLabel(snapshot)}
      </Text>
      <Text selectable style={mobileType.body} testID="media-job-artifact">
        {artifactLabel(snapshot)}
      </Text>
      <Text selectable style={mobileType.body} testID="media-job-service">
        {serviceLabel(snapshot)}
      </Text>
      <JobActions
        busy={busy}
        onCommand={onCommand}
        snapshot={snapshot}
        {...(onDelete === undefined ? {} : { onDelete })}
        {...(onExport === undefined ? {} : { onExport })}
        {...(onOpen === undefined ? {} : { onOpen })}
      />
      </MobileStatusPanel>
    </View>
  );
}

function MissingJob() {
  return (
    <View style={styles.screen}>
      <MobileScreenHeader title="Media Job" />
      <MobileStatusPanel testID="media-job-missing" tone="empty">
        <Text selectable style={mobileType.body}>
          This Media Job is not on the device yet. Recover jobs from Diagnostics
          or start a fixture job.
        </Text>
      </MobileStatusPanel>
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
        <MobileButton
          accessibilityLabel={mediaJobCommandLabel(command, snapshot.intent.kind)}
          busy={busy}
          key={command}
          onPress={() => onCommand(command)}
          testID={`media-job-command-${command}`}
          variant={command === "cancel" ? "destructive" : "secondary"}
        >
          {mediaJobCommandLabel(command, snapshot.intent.kind)}
        </MobileButton>
      ))}
      {snapshot.phase === "completed" && onOpen ? (
        <MobileButton
          accessibilityLabel="Open"
          busy={busy}
          onPress={onOpen}
          testID="media-job-open"
          variant="primary"
        >
          Open
        </MobileButton>
      ) : null}
      {snapshot.phase === "completed" && onExport ? (
        <MobileButton
          accessibilityLabel="Export"
          busy={busy}
          onPress={onExport}
          testID="media-job-export"
          variant="secondary"
        >
          Export
        </MobileButton>
      ) : null}
      {canDeleteJob(snapshot.phase) && onDelete ? (
        <MobileButton
          accessibilityLabel="Delete"
          busy={busy}
          onPress={onDelete}
          testID="media-job-delete"
          variant="destructive"
        >
          Delete
        </MobileButton>
      ) : null}
    </View>
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
  screen: { gap: mobileSpacing.medium },
});
