import { StyleSheet, Text, View } from "react-native";
import type { MediaJobSnapshot } from "@streamfusion/core/media-jobs";

import { MobileButton } from "@mobile/design/button";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileScreenHeader } from "@mobile/design/screen-header";
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
      <MobileScreenHeader
        summary="Downloads and recordings you start from Watch appear here. Nothing autoplays."
        title="Downloads"
      />
      {jobs.length === 0 ? (
        <MobileStatusPanel testID="downloads-empty" tone="empty">
          <Text selectable style={mobileType.title}>
            No downloads yet
          </Text>
          <Text selectable style={mobileType.body}>
            Start a download or recording from a Watch session. Jobs also show
            under Activity.
          </Text>
        </MobileStatusPanel>
      ) : (
        <View style={styles.stack}>
          {jobs.map((job) => {
            const jobId = job.intent.jobId;
            return (
              <View
                key={jobId}
                style={styles.card}
                testID={`downloads-job-${jobId}`}
              >
                <Text selectable style={styles.title}>
                  {job.intent.kind}
                </Text>
                <Text selectable style={styles.meta}>
                  {mediaJobPhaseLabel(job.phase)}
                </Text>
                <MobileButton
                  accessibilityLabel={`Open media job ${jobId}`}
                  onPress={() => onOpenJob(jobId)}
                  testID={`downloads-open-${jobId}`}
                  variant="secondary"
                >
                  Open
                </MobileButton>
              </View>
            );
          })}
        </View>
      )}
    </MobileRefreshableScroll>
  );
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
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
    textTransform: "capitalize",
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
