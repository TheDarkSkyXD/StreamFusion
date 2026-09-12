import type {
  MediaJobCommandName,
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
  snapshot,
  status,
}: {
  readonly busy?: boolean;
  readonly onCommand: (command: MediaJobCommandName) => void;
  readonly snapshot: MediaJobSnapshot | null;
  readonly status?: string | null;
}) {
  if (!snapshot) {
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
  const percent =
    snapshot.progress.totalBytes && snapshot.progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (snapshot.progress.transferredBytes /
              snapshot.progress.totalBytes) *
              100,
          ),
        )
      : snapshot.artifact.kind === "complete"
        ? 100
        : null;
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
        {status ?? snapshot.statusMessage}
      </Text>
      <Text selectable style={styles.body} testID="media-job-progress">
        {percent === null
          ? `${snapshot.progress.transferredBytes} bytes`
          : `${percent}% · ${snapshot.progress.transferredBytes} bytes`}
      </Text>
      <Text selectable style={styles.body} testID="media-job-artifact">
        {artifactLabel(snapshot)}
      </Text>
      <Text selectable style={styles.body} testID="media-job-service">
        {snapshot.service.kind === "owned"
          ? "Android service owns this job."
          : "No Android service currently owns this job."}
      </Text>
      <View style={styles.actions}>
        {commandOrder
          .filter((command) => validCommands(snapshot.phase).includes(command))
          .map((command) => (
            <Pressable
              accessibilityLabel={mediaJobCommandLabel(command)}
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
              disabled={busy}
              key={command}
              onPress={() => onCommand(command)}
              style={styles.button}
              testID={`media-job-command-${command}`}
            >
              <Text selectable style={styles.buttonLabel}>
                {mediaJobCommandLabel(command)}
              </Text>
            </Pressable>
          ))}
      </View>
    </View>
  );
}

function artifactLabel(snapshot: MediaJobSnapshot): string {
  if (snapshot.artifact.kind === "none") return "No artifact yet.";
  const qualifier =
    snapshot.artifact.kind === "complete" ? "Complete" : "Partial";
  return `${qualifier} artifact · ${snapshot.artifact.bytes} bytes`;
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
