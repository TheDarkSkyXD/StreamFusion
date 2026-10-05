import { useState } from "react";
import { Text } from "react-native";
import { MobileBottomSheet } from "@mobile/design/bottom-sheet";
import { MobileButton } from "@mobile/design/button";
import { MobileDialog } from "@mobile/design/dialog";
import { MobileProgress } from "@mobile/design/feedback";
import { MobileListRow } from "@mobile/design/list-row";
import { mobileType } from "@mobile/design/tokens";
import type { CaptionModelState } from "@mobile/features/native-contracts/capabilities/android-capability-contracts";
export function CaptionModelManagement({
  busy,
  model,
  onInstall,
  onRemove,
  onCancelInstall,
  status,
}: {
  readonly busy: boolean;
  readonly model: CaptionModelState | null | undefined;
  readonly onInstall: (() => void) | undefined;
  readonly onRemove: (() => void) | undefined;
  readonly onCancelInstall: (() => void) | undefined;
  readonly status: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [removeDialog, setRemoveDialog] = useState(false);
  const installing =
    model?.phase === "downloading" || model?.phase === "verifying";
  const installed =
    model?.pack === "product" && model.installed && model.sha256Verified;
  return (
    <>
      <MobileButton
        accessibilityLabel="Caption models"
        variant="ghost"
        testID="watch-caption-models"
        onPress={() => setOpen(true)}
      >
        Caption models
      </MobileButton>
      <MobileBottomSheet
        title="Caption models"
        visible={open}
        onDismiss={() => setOpen(false)}
      >
        <Text style={mobileType.body}>
          One download. Captions then run offline on this device.
        </Text>
        <MobileListRow
          title="English"
          description="Vosk small English � 39.30 MiB � Apache-2.0"
        />
        <Text style={mobileType.body} accessibilityLiveRegion="polite">
          {status ??
            model?.statusMessage ??
            "Model state is unavailable in this host."}
        </Text>
        {installing ? (
          <>
            <MobileProgress
              label={`${model?.phase === "verifying" ? "Verifying" : "Downloading"} � ${((model?.downloadedBytes ?? 0) / 1048576).toFixed(2)} MiB of 39.30 MiB`}
              value={
                model && model.expectedBytes > 0
                  ? Math.min(1, model.downloadedBytes / model.expectedBytes)
                  : 0
              }
            />
            {onCancelInstall ? (
              <MobileButton
                accessibilityLabel="Cancel model download"
                variant="secondary"
                testID="caption-model-cancel"
                onPress={onCancelInstall}
              >
                Cancel download
              </MobileButton>
            ) : (
              <Text style={mobileType.body}>
                Cancellation is unavailable in this host.
              </Text>
            )}
          </>
        ) : installed ? (
          <MobileButton
            accessibilityLabel="Remove English model"
            testID="caption-model-remove"
            disabled={busy || !onRemove}
            variant="destructive"
            onPress={() => setRemoveDialog(true)}
          >
            Remove model
          </MobileButton>
        ) : (
          <MobileButton
            accessibilityLabel="Download English model"
            testID="caption-model-install"
            disabled={busy || !onInstall}
            variant="primary"
            onPress={() => onInstall?.()}
          >
            Download � 39.30 MiB
          </MobileButton>
        )}
        <Text style={mobileType.label}>
          Program audio only. No microphone. No audio upload.
        </Text>
      </MobileBottomSheet>
      <MobileDialog
        title="Remove English model?"
        message="Captions will stop. Download the model again to use offline captions."
        visible={removeDialog}
        destructive
        confirmLabel="Remove model"
        onCancel={() => setRemoveDialog(false)}
        onConfirm={() => {
          setRemoveDialog(false);
          if (!busy) onRemove?.();
        }}
      />
    </>
  );
}
