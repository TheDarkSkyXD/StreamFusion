import type {
  MediaJobCommandName,
  MediaJobPhase,
  MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { validCommands } from "@streamfusion/core/media-jobs";
import { useState } from "react";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileListRow } from "@mobile/design/list-row";
import { useTransferObservation } from "./use-transfer-observation";
import { mediaJobDisplay } from "../utils/media-display";
import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
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
    <MediaJobDetail
      busy={busy}
      onCommand={onCommand}
      snapshot={snapshot}
      {...(onDelete ? { onDelete } : {})}
      {...(onExport ? { onExport } : {})}
      {...(onOpen ? { onOpen } : {})}
      {...(status === undefined ? {} : { status })}
    />
  );
}
function MediaJobDetail({
  busy = false,
  onCommand,
  onDelete,
  onExport,
  onOpen,
  snapshot,
  status,
}: Omit<Parameters<typeof MediaJobScreen>[0], "snapshot"> & {
  readonly snapshot: MediaJobSnapshot;
}) {
  const transfer = useTransferObservation(snapshot);
  return (
    <View style={styles.screen}>
      <MobileStatusPanel testID="media-job-detail" tone="info">
        <Text selectable style={mobileType.body} testID="media-job-title">
          {mediaJobDisplay(snapshot)?.title ??
            (snapshot.intent.kind === "download" ? "Download" : "Recording")}
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
        <MobileListRow
          title="Source"
          description={
            mediaJobDisplay(snapshot)?.channelName ??
            "Source metadata unavailable"
          }
        />
        <MobileListRow
          title="Transfer speed"
          description={
            transfer.bytesPerSecond === null
              ? "Waiting for measured transfer samples"
              : `${(transfer.bytesPerSecond / 1048576).toFixed(2)} MiB/s · measured`
          }
        />
        <MobileListRow
          title="Time remaining"
          description={
            transfer.remainingSeconds === null
              ? "Unavailable. The source has not reported a total size or measured rate."
              : `About ${Math.ceil(transfer.remainingSeconds)} seconds`
          }
        />
        {snapshot.intent.kind === "recording" &&
        snapshot.artifact.kind === "partial" ? (
          <Text style={mobileType.body}>
            This recording was interrupted. Keep the segment after verifying it
            plays, or delete its files.
          </Text>
        ) : null}
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
      <MobileStatusPanel testID="media-job-missing" tone="empty">
        <Text selectable style={mobileType.body}>
          This media job is not on this device. Refresh Downloads to recover
          saved jobs.
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
  const [confirmation, setConfirmation] = useState<"delete" | "keep" | null>(
    null,
  );
  const recovery =
    snapshot.intent.kind === "recording" &&
    snapshot.artifact.kind === "partial" &&
    snapshot.artifact.bytes > 0;
  const commands = commandOrder.filter(
    (command) =>
      validCommands(snapshot.phase).includes(command) ||
      (command === "finalize" && recovery && snapshot.phase === "completed"),
  );
  return (
    <View style={styles.actions}>
      <MobileDialog
        title={confirmation === "keep" ? "Keep recording?" : "Delete media?"}
        visible={confirmation !== null}
        confirmLabel={confirmation === "keep" ? "Keep segment" : "Delete"}
        destructive={confirmation === "delete"}
        message={
          confirmation === "keep"
            ? "The saved segment will be verified before it is kept. The result appears in Downloads."
            : "This removes the job and its media files from this device."
        }
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const action = confirmation;
          setConfirmation(null);
          if (busy) return;
          if (action === "keep") onCommand("finalize");
          if (action === "delete") onDelete?.();
        }}
      />
      {commands.map((command) => (
        <MobileButton
          accessibilityLabel={
            recovery && command === "finalize"
              ? "Keep playable segment"
              : mediaJobCommandLabel(command, snapshot.intent.kind)
          }
          busy={busy}
          key={command}
          onPress={() =>
            recovery && command === "finalize"
              ? setConfirmation("keep")
              : onCommand(command)
          }
          testID={`media-job-command-${command}`}
          variant={command === "cancel" ? "destructive" : "secondary"}
        >
          {recovery && command === "finalize"
            ? "Keep playable segment"
            : mediaJobCommandLabel(command, snapshot.intent.kind)}
        </MobileButton>
      ))}
      {snapshot.phase === "completed" &&
      snapshot.artifact.kind === "complete" &&
      onOpen ? (
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
      {snapshot.phase === "completed" &&
      snapshot.artifact.kind === "complete" &&
      onExport ? (
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
          onPress={() => setConfirmation("delete")}
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
