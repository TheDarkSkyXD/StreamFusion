import type { MediaJobCommandName, MediaJobSnapshot } from "@streamfusion/core/media-jobs";
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
      <View style={styles.panel} testID="watch-download">
        <Text selectable style={styles.body} testID="watch-download-unsupported">
          {eligibility.reason}
        </Text>
      </View>
    );
  }
  const percent =
    job?.progress.totalBytes && job.progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (job.progress.transferredBytes / job.progress.totalBytes) * 100,
          ),
        )
      : job?.artifact.kind === "complete"
        ? 100
        : null;
  return (
    <View style={styles.panel} testID="watch-download">
      {job ? (
        <>
          <Text selectable style={styles.body} testID="watch-download-phase">
            {mediaJobPhaseLabel(job.phase)}
          </Text>
          <Text selectable style={styles.body} testID="watch-download-status">
            {status ?? job.statusMessage}
          </Text>
          <Text selectable style={styles.body} testID="watch-download-progress">
            {percent === null
              ? `${job.progress.transferredBytes} bytes`
              : `${percent}% · ${job.progress.transferredBytes} bytes`}
          </Text>
          <View style={styles.actions}>
            {jobCommands
              .filter((command) => validCommands(job.phase).includes(command))
              .map((command) => (
                <Action
                  busy={busy}
                  key={command}
                  label={mediaJobCommandLabel(command)}
                  onPress={() => onCommand(command)}
                  testID={`watch-download-command-${command}`}
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
            {job.phase === "completed" ||
            job.phase === "canceled" ||
            job.phase === "failed-retryable" ||
            job.phase === "failed-terminal" ? (
              <Action
                busy={busy}
                label="Delete"
                onPress={onDelete}
                testID="watch-download-delete"
              />
            ) : null}
          </View>
        </>
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
