import { StyleSheet, Text, View } from "react-native";
import type { MediaJobSnapshot } from "@streamfusion/core/media-jobs";

import { MobileButton } from "@mobile/design/button";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { mediaJobPhaseLabel } from "../utils/media-job-labels";

export function DownloadsScreen({
  jobs,
  onOpenJob,
  onRefresh,
  refreshing = false,
}: {
  readonly jobs: readonly MediaJobSnapshot[];
  readonly onOpenJob: (jobId: string) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly refreshing?: boolean;
}) {
  return (
    <MobileRefreshableScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      onRefresh={onRefresh}
      refreshing={refreshing}
      style={styles.scroll}
      testID="screen-downloads"
    >
      {jobs.length === 0 ? (
        <MobileStatusPanel testID="downloads-empty" tone="empty">
          <Text selectable style={mobileType.title}>
            No downloads yet
          </Text>
          <Text selectable style={mobileType.body}>
            Start one from Watch.
          </Text>
        </MobileStatusPanel>
      ) : (
        <View style={styles.stack}>
          {jobs.map((job) => {
            const jobId = job.intent.jobId;
            const progress = progressRatio(job);
            return (
              <View
                key={jobId}
                style={styles.card}
                testID={`downloads-job-${jobId}`}
              >
                <View style={styles.thumbWrap}>
                  <View style={styles.thumb}>
                    <Text selectable style={styles.kindBadge}>
                      {job.intent.kind.toUpperCase()}
                    </Text>
                  </View>
                  {progress === null ? null : (
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${progress * 100}%` },
                        ]}
                      />
                    </View>
                  )}
                </View>
                <View style={styles.meta}>
                  <View style={styles.copy}>
                    <Text selectable style={styles.title}>
                      {jobTitle(job)}
                    </Text>
                    <Text selectable style={styles.status}>
                      {mediaJobPhaseLabel(job.phase)}
                      {job.statusMessage ? ` · ${job.statusMessage}` : ""}
                    </Text>
                    {progress === null ? null : (
                      <Text selectable style={styles.progressLabel}>
                        {`${Math.round(progress * 100)}%`}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.actions}>
                  <MobileButton
                    accessibilityLabel={`Open media job ${jobId}`}
                    onPress={() => onOpenJob(jobId)}
                    testID={`downloads-open-${jobId}`}
                    variant="secondary"
                  >
                    {job.phase === "completed" ? "Open" : "Details"}
                  </MobileButton>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </MobileRefreshableScroll>
  );
}

function jobTitle(job: MediaJobSnapshot): string {
  const uri = job.intent.sourceUri;
  if (!uri) return job.intent.kind;
  try {
    const path = uri.split("?")[0] ?? uri;
    const leaf = path.split("/").filter(Boolean).at(-1);
    return leaf && leaf.length > 0 ? decodeURIComponent(leaf) : job.intent.kind;
  } catch {
    return job.intent.kind;
  }
}

function progressRatio(job: MediaJobSnapshot): number | null {
  const total = job.progress.totalBytes;
  if (total === null || total <= 0) return null;
  return Math.min(1, Math.max(0, job.progress.transferredBytes / total));
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: mobileColors.background },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: mobileSpacing.xLarge,
  },
  stack: { gap: mobileSpacing.medium },
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    overflow: "hidden",
  },
  thumbWrap: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    width: "100%",
  },
  thumb: {
    alignItems: "flex-start",
    flex: 1,
    justifyContent: "flex-start",
    padding: mobileSpacing.small,
  },
  kindBadge: {
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.small,
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
    overflow: "hidden",
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
  },
  progressTrack: {
    backgroundColor: "rgba(255,255,255,0.24)",
    bottom: 0,
    height: 4,
    left: 0,
    position: "absolute",
    right: 0,
  },
  progressFill: {
    backgroundColor: mobileColors.textPrimary,
    height: 4,
  },
  meta: {
    padding: mobileSpacing.medium,
  },
  copy: { gap: mobileSpacing.xSmall },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  status: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  progressLabel: {
    color: mobileColors.textCategory,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    gap: mobileSpacing.small,
    paddingBottom: mobileSpacing.medium,
    paddingHorizontal: mobileSpacing.medium,
  },
});
