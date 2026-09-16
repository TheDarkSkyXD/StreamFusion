import type {
  MediaJobCommandName,
  MediaJobPhase,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { validCommands } from "@streamfusion/core/media-jobs";
import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import { mobileSpacing, mobileType } from "@mobile/design/tokens";
import {
  mediaJobCommandLabel,
  mediaJobDisplayedStatus,
  mediaJobPhaseLabel,
} from "@mobile/features/media-jobs/utils/media-job-labels";

import type { WatchDownloadEligibility } from "../domain/watch-download";

const jobCommands: readonly Exclude<MediaJobCommandName, "start">[] = [
  "pause",
  "resume",
  "retry",
  "cancel",
];

export function WatchDownloadBar({
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
  readonly eligibility: WatchDownloadEligibility;
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
      <MobileStatusPanel testID="watch-download" tone="info">
        <Text selectable style={mobileType.body} testID="watch-download-unsupported">
          {eligibility.reason}
        </Text>
      </MobileStatusPanel>
    );
  }
  return (
    <View style={styles.panel} testID="watch-download">
      {job ? (
        <ActiveDownload
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
          testID="watch-download-start"
        />
      )}
    </View>
  );
}

function ActiveDownload({
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
      <Text selectable style={mobileType.body} testID="watch-download-phase">
        {mediaJobPhaseLabel(job.phase)}
      </Text>
      <Text selectable style={mobileType.body} testID="watch-download-status">
        {mediaJobDisplayedStatus(status, job.statusMessage)}
      </Text>
      <Text selectable style={mobileType.body} testID="watch-download-progress">
        {progressLabel(job)}
      </Text>
      <View style={styles.actions}>
        {commands.map((command) => (
          <Action
            busy={busy}
            key={command}
            label={mediaJobCommandLabel(command)}
            onPress={() => onCommand(command)}
            testID={`watch-download-command-${command}`}
            variant={command === "cancel" ? "destructive" : "secondary"}
          />
        ))}
        {job.phase === "completed" ? (
          <>
            <Action
              busy={busy}
              label="Open"
              onPress={onOpenArtifact}
              testID="watch-download-open"
            />
            <Action
              busy={busy}
              label="Export"
              onPress={onExport}
              testID="watch-download-export"
            />
          </>
        ) : null}
        {canDeleteJob(job.phase) ? (
          <Action
            busy={busy}
            label="Delete"
            onPress={onDelete}
            testID="watch-download-delete"
            variant="destructive"
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
  variant = "secondary",
}: {
  readonly busy: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly variant?: "secondary" | "destructive";
}) {
  return (
    <MobileButton
      accessibilityLabel={label}
      busy={busy}
      onPress={onPress}
      testID={testID}
      variant={variant}
    >
      {label}
    </MobileButton>
  );
}

function progressLabel(job: MediaJobSnapshot): string {
  const { totalBytes, transferredBytes } = job.progress;
  if (totalBytes && totalBytes > 0) {
    const percent = Math.min(
      100,
      Math.round((transferredBytes / totalBytes) * 100),
    );
    return `${percent}% · ${transferredBytes} bytes`;
  }
  if (job.artifact.kind === "complete") {
    return `100% · ${transferredBytes} bytes`;
  }
  return `${transferredBytes} bytes`;
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
  panel: { gap: mobileSpacing.small },
});
