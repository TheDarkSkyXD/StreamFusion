import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";

import type { DevelopmentActivityProofViewModel } from "../capabilities/development-activity-proof";

export function DevelopmentActivityProofControl({
  model,
  onExit,
  onQueueReadFailure,
  onRefresh,
  onReplay,
  onRetryCleanup,
  onStart,
}: {
  readonly model: DevelopmentActivityProofViewModel;
  readonly onExit: () => Promise<void>;
  readonly onQueueReadFailure: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly onReplay: () => Promise<void>;
  readonly onRetryCleanup: () => Promise<void>;
  readonly onStart: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const proofSelected = model.kind === "proof";
  const cleanupRequired = model.kind === "cleanup-required";
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    try {
      await operation();
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.panel} testID="development-activity-proof-control">
      <Text selectable style={styles.label}>
        DEVELOPMENT ACTIVITY PROOF
      </Text>
      <Text
        selectable
        style={styles.detail}
        testID="development-activity-proof-detail"
      >
        {model.detail}
      </Text>
      {proofSelected ? (
        <Text selectable style={styles.detail}>
          Synthetic local Activity only. This does not prove provider delivery,
          media services, or SQLCipher by itself.
        </Text>
      ) : null}
      <View style={styles.actions}>
        {!proofSelected && !cleanupRequired ? (
          <ProofButton
            label="Start isolated Activity proof"
            busy={busy}
            onPress={() => void run(onStart)}
            testID="start-development-activity-proof"
          />
        ) : null}
        {proofSelected ? (
          <>
            <ProofButton
              label="Replay proof Activity"
              busy={busy}
              onPress={() => void run(onReplay)}
              testID="replay-development-activity-proof"
            />
            <ProofButton
              label="Queue Activity read failure"
              busy={busy}
              onPress={() =>
                void run(async () => {
                  onQueueReadFailure();
                })
              }
              testID="queue-development-activity-read-failure"
            />
            <ProofButton
              label="Exit isolated Activity proof"
              busy={busy}
              onPress={() => void run(onExit)}
              testID="exit-development-activity-proof"
            />
          </>
        ) : null}
        {cleanupRequired ? (
          <ProofButton
            label="Retry isolated Activity cleanup"
            busy={busy}
            onPress={() => void run(onRetryCleanup)}
            testID="retry-development-activity-cleanup"
          />
        ) : null}
      </View>
    </View>
  );
}

function ProofButton({
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
  button: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    minHeight: 48,
    paddingHorizontal: mobileSpacing.medium,
    justifyContent: "center",
  },
  buttonLabel: { color: mobileColors.textPrimary, fontWeight: "700" },
  detail: { color: mobileColors.textSecondary, lineHeight: 20 },
  label: { color: mobileColors.textCategory, fontSize: 12, fontWeight: "700" },
  panel: {
    backgroundColor: mobileColors.surface,
    borderRadius: mobileRadii.medium,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
});
