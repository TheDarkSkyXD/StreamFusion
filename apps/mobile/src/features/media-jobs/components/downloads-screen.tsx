import { useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import type { MediaJobSnapshot } from "@streamfusion/core/media-jobs";
import { MobileButton } from "@mobile/design/button";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileTextField } from "@mobile/design/text-input";
import { MobileProgress } from "@mobile/design/feedback";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { mediaJobDisplay } from "../utils/media-display";
import {
  filterMediaJobs,
  type MediaLibraryFilter,
} from "../domain/media-library-filter";
import { useTransferObservation } from "./use-transfer-observation";
import { mediaJobPhaseLabel } from "../utils/media-job-labels";
const filters: readonly {
  readonly value: MediaLibraryFilter;
  readonly label: string;
}[] = [
  { value: "all", label: "All" },
  { value: "video", label: "Videos" },
  { value: "clip", label: "Clips" },
  { value: "recording", label: "Recordings" },
];
export function DownloadsScreen({
  jobs,
  onOpenJob,
  onRefresh,
  refreshing = false,
  offline = false,
}: {
  readonly jobs: readonly MediaJobSnapshot[];
  readonly onOpenJob: (jobId: string) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly refreshing?: boolean;
  readonly offline?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<MediaLibraryFilter>("all");
  const visible = filterMediaJobs(jobs, query, filter);
  return (
    <MobileRefreshableScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      onRefresh={onRefresh}
      refreshing={refreshing}
      style={styles.screen}
      testID="screen-downloads"
    >
      <MobileTextField
        label="Search downloads"
        placeholder="Channel or title"
        value={query}
        onChange={setQuery}
      />
      <View style={styles.filters}>
        {filters.map((item) => (
          <MobileFilterChip
            key={item.value}
            label={item.label}
            accessibilityLabel={item.label}
            selected={filter === item.value}
            onPress={() => setFilter(item.value)}
            testID={`downloads-filter-${item.value}`}
          />
        ))}
      </View>
      {offline ? (
        <MobileStatusPanel tone="info" testID="downloads-offline">
          <Text style={mobileType.body}>
            You are offline. Saved files remain available on this device.
          </Text>
        </MobileStatusPanel>
      ) : null}
      <Text style={mobileType.title}>On this device</Text>
      {visible.length === 0 ? (
        <MobileStatusPanel testID="downloads-empty" tone="empty">
          <Text style={mobileType.title}>
            {jobs.length ? "No matching downloads" : "No downloads yet"}
          </Text>
          <Text style={mobileType.body}>
            {jobs.length
              ? "Try a different search or filter."
              : "Start one from Watch."}
          </Text>
        </MobileStatusPanel>
      ) : null}
      {visible.map((job) => (
        <DownloadRow
          key={job.intent.jobId}
          job={job}
          onOpen={() => onOpenJob(job.intent.jobId)}
        />
      ))}
    </MobileRefreshableScroll>
  );
}
export function DownloadRow({
  job,
  onOpen,
}: {
  readonly job: MediaJobSnapshot;
  readonly onOpen: () => void;
}) {
  const display = mediaJobDisplay(job);
  const transfer = useTransferObservation(job);
  const total = job.progress.totalBytes;
  const progress =
    total && total > 0
      ? Math.min(1, job.progress.transferredBytes / total)
      : null;
  const saved = job.phase === "completed" && job.artifact.kind === "complete";
  return (
    <View style={styles.row} testID={`downloads-job-${job.intent.jobId}`}>
      <View style={styles.media}>
        {display?.thumbnailUrl ? (
          <Image
            source={{ uri: display.thumbnailUrl }}
            style={styles.thumbnail}
          />
        ) : (
          <View style={styles.thumbnail} />
        )}
        <View style={styles.copy}>
          <Text numberOfLines={2} style={mobileType.title}>
            {display?.title ??
              (job.intent.kind === "recording"
                ? "Saved recording"
                : "Saved download")}
          </Text>
          <Text style={mobileType.body}>
            {display?.channelName ?? "Source metadata unavailable"}
          </Text>
          <Text style={mobileType.label}>
            {mediaJobPhaseLabel(job.phase)} ·{" "}
            {(job.progress.transferredBytes / 1048576).toFixed(1)} MiB
            {saved ? " · Available offline" : ""}
          </Text>
        </View>
      </View>
      {transfer.bytesPerSecond !== null ? (
        <Text style={mobileType.label}>
          {(transfer.bytesPerSecond / 1048576).toFixed(2)} MiB/s · measured
          transfer
        </Text>
      ) : null}
      {progress !== null && !saved ? (
        <MobileProgress
          label={`${Math.round(progress * 100)}%`}
          value={progress}
        />
      ) : null}
      <MobileButton
        accessibilityLabel={`Open media job ${job.intent.jobId}`}
        onPress={onOpen}
        testID={`downloads-open-${job.intent.jobId}`}
        variant="ghost"
      >
        {saved ? "Open" : "Details"}
      </MobileButton>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: mobileColors.background },
  content: {
    padding: mobileSpacing.medium,
    gap: mobileSpacing.medium,
    paddingBottom: 96,
  },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
  row: {
    gap: mobileSpacing.small,
    borderBottomWidth: 1,
    borderBottomColor: mobileColors.border,
    paddingBottom: mobileSpacing.small,
  },
  media: { flexDirection: "row", gap: mobileSpacing.small },
  thumbnail: {
    width: 112,
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
  },
  copy: { flex: 1, gap: mobileSpacing.xSmall },
});
