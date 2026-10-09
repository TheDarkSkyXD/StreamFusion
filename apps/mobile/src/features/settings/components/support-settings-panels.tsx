import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { mobileSpacing } from "@mobile/design/tokens";
import { UpdateDialog } from "@mobile/features/app-update/components/update-dialog";
import { updatePresentation, type UpdateAction } from "@mobile/features/app-update/domain/update-presentation";

import {
  CHECK_FREQUENCIES,
  DIAGNOSTIC_WINDOWS,
  LOG_LEVELS,
  LOG_SOURCES,
  type SupportSettingsSession,
  type SupportSettingsView,
} from "../capabilities/support-settings";
import {
  SettingsAction,
  SettingsCopy,
  SettingsField,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "./settings-controls";

const MAINTENANCE_ACTIONS = [
  { kind: "clear-history", label: "Clear history" },
  { kind: "remove-media", label: "Remove media" },
  { kind: "disconnect-accounts", label: "Disconnect accounts" },
  { kind: "reset-app", label: "Reset the app" },
] as const;

const styles = StyleSheet.create({
  updateNotice: {
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
    gap: mobileSpacing.small,
  },
});

function logLinesCopy(logs: SupportSettingsView["logs"]): string {
  if (logs.length === 0) {
    return "No redacted runtime lines match this filter.";
  }
  return logs
    .map((entry) => `${entry.level} ${entry.source}: ${entry.message}`)
    .join("\n");
}

export function UpdatesSettingsPanel({
  session,
}: {
  readonly session: SupportSettingsSession;
}) {
  const view = useSupportView(session);
  const release = view.update.status === "available" || view.update.status === "current"
    ? view.update.release
    : null;
  const presentation = updatePresentation(view.updater, view.update.status === "available" ? view.update.release : null);
  const handoff = presentation?.kind === "handoff" ? presentation : null;
  return (
    <SettingsSection testID="panel-updates" title="UPDATES">
      <SettingsCopy
        testID="update-status"
        value={view.updateCopy}
      />
      <SettingsCopy
        testID="update-last-checked"
        value={view.preferences.lastCheckAt === null
          ? "No successful check yet."
          : `Last successful check ${new Date(view.preferences.lastCheckAt).toLocaleString()}`}
      />
      {view.releaseOpenError ? (
        <SettingsCopy testID="update-open-error" value={view.releaseOpenError} />
      ) : null}
      <SettingsCopy
        testID="automatic-foreground-update-checks-copy"
        value={view.deniedCopy}
      />
      <SettingsSwitch
        checked={view.preferences.allowPrerelease}
        detail="Include Android alpha, beta, and release candidates."
        label="Allow prerelease updates"
        onToggle={() => {
          void session.apply({ allowPrerelease: !view.preferences.allowPrerelease });
        }}
        testID="allow-prerelease-updates"
      />
      <SettingsSwitch
        checked={view.preferences.automaticForegroundUpdateChecks}
        label="Check again when returning to app"
        onToggle={() => {
          void session.apply({
            automaticForegroundUpdateChecks:
              !view.preferences.automaticForegroundUpdateChecks,
          });
        }}
        testID="automatic-foreground-update-checks"
      />
      <SettingsSelect
        current={view.preferences.checkFrequency}
        detail="Minimum time between return-to-app checks. Launch always checks."
        disabled={!view.preferences.automaticForegroundUpdateChecks}
        label="Check frequency"
        onSelect={(checkFrequency) => {
          void session.apply({ checkFrequency });
        }}
        options={CHECK_FREQUENCIES.map((value) => ({
          label: value === "hourly" ? "Hourly" : value === "daily" ? "Daily" : "Weekly",
          value,
        }))}
        testID="check-frequency"
      />
      <SettingsAction
        disabled={view.update.status === "checking"}
        label={view.update.status === "checking" ? "Checking..." : "Check now"}
        onPress={() => {
          void session.checkForUpdates();
        }}
        testID="check-for-updates"
      />
      {handoff ? (
        <>
          <SettingsCopy testID="update-handoff-status" value={handoff.detail} />
          {handoff.installLabel ? (
            <SettingsAction
              label={handoff.installLabel}
              onPress={() => { void session.installUpdate(); }}
              testID="update-handoff-install"
            />
          ) : null}
        </>
      ) : view.update.status === "available" ? (
        <SettingsAction
          label={view.updater.kind === "idle" || view.updater.kind === "unsupported"
            ? "Open update" : "Open update progress"}
          onPress={() => { session.openUpdate(); }}
          testID="open-update"
        />
      ) : null}
      {!handoff && view.updater.kind !== "idle" && view.updater.kind !== "unsupported" &&
        view.update.status !== "available" ? (
          <SettingsAction
            label="Open update progress"
            onPress={() => { session.openUpdate(); }}
            testID="open-update-progress"
          />
        ) : null}
      {view.updateOperationError ? (
        <SettingsCopy testID="update-operation-error" value={view.updateOperationError} />
      ) : null}
      {release ? (
        <>
          <SettingsAction
            label="View GitHub release"
            onPress={() => { void session.openRelease(); }}
            testID="view-update-release"
          />
          <SettingsCopy
            testID="update-release-notes"
            value={`Android ${release.version} release notes\n${release.notes || "No release notes were provided."}`}
          />
        </>
      ) : null}
    </SettingsSection>
  );
}

export function UpdateAvailableNotice({
  session,
}: {
  readonly session: SupportSettingsSession;
}) {
  const view = useSupportView(session);
  if (view.update.status !== "available") return null;
  const presentation = updatePresentation(view.updater, view.update.release);
  const handoff = presentation?.kind === "handoff" ? presentation : null;
  return (
    <View style={styles.updateNotice} testID="update-available-notice">
      <SettingsCopy
        testID="update-available-notice-copy"
        value={handoff?.detail ?? `StreamFusion Android ${view.update.release.version} is available.`}
      />
      {view.releaseOpenError ? (
        <SettingsCopy testID="update-available-notice-error" value={view.releaseOpenError} />
      ) : null}
      {view.updateOperationError ? (
        <SettingsCopy testID="update-available-notice-operation-error" value={view.updateOperationError} />
      ) : null}
      {handoff ? handoff.installLabel ? (
        <SettingsAction
          label={handoff.installLabel}
          onPress={() => { void session.installUpdate(); }}
          testID="notice-handoff-install"
        />
      ) : null : (
        <SettingsAction
          label="Open update"
          onPress={() => { session.openUpdate(); }}
          testID="open-available-update"
        />
      )}
    </View>
  );
}

export function UpdateDialogHost({ session }: { readonly session: SupportSettingsSession }) {
  const view = useSupportView(session);
  const offered = view.update.status === "available" ? view.update.release : null;
  const model = updatePresentation(view.updater, offered);
  if (model?.kind === "handoff") return null;
  function onAction(action: UpdateAction): void {
    switch (action) {
      case "download": void session.downloadUpdate(); return;
      case "later": void session.laterUpdate(); return;
      case "cancel": void session.cancelUpdate(); return;
      case "hide": void session.hideUpdate(); return;
      case "retry": void session.retryUpdate(); return;
      case "install": void session.installUpdate(); return;
    }
  }
  return <UpdateDialog model={model} onAction={onAction} operationError={view.updateOperationError} visible={view.updatePopupVisible} />;
}

export function DiagnosticsSettingsPanel({
  onOpenDiagnostics,
  session,
}: {
  readonly onOpenDiagnostics: () => void;
  readonly session: SupportSettingsSession;
}) {
  const view = useSupportView(session);
  return (
    <SettingsSection testID="panel-diagnostics" title="DIAGNOSTICS">
      <SettingsSelect
        current={view.preferences.diagnosticWindow}
        label="Observation window"
        onSelect={(diagnosticWindow) => {
          void session.apply({ diagnosticWindow });
        }}
        options={DIAGNOSTIC_WINDOWS.map((value) => ({
          label: value,
          value,
        }))}
        testID="diagnostic-window"
      />
      <SettingsSelect
        current={view.preferences.diagnosticIoWindow}
        label="I/O observation window"
        onSelect={(diagnosticIoWindow) => {
          void session.apply({ diagnosticIoWindow });
        }}
        options={DIAGNOSTIC_WINDOWS.map((value) => ({
          label: value,
          value,
        }))}
        testID="diagnostic-io-window"
      />
      <SettingsSwitch
        checked={view.preferences.diagnosticDetail}
        label="Detailed collection"
        onToggle={() => {
          void session.apply({
            diagnosticDetail: !view.preferences.diagnosticDetail,
          });
        }}
        testID="diagnostic-detail"
      />
      <SettingsAction
        label="Open Diagnostics"
        onPress={onOpenDiagnostics}
        testID="open-diagnostics"
      />
    </SettingsSection>
  );
}

export function LogsSettingsPanel({
  session,
}: {
  readonly session: SupportSettingsSession;
}) {
  const view = useSupportView(session);
  return (
    <SettingsSection testID="panel-logs" title="LOGS">
      <SettingsSelect
        current={view.preferences.logLevel}
        label="Minimum level"
        onSelect={(logLevel) => {
          void session.apply({ logLevel });
        }}
        options={LOG_LEVELS.map((value) => ({
          label: value,
          value,
        }))}
        testID="log-level"
      />
      <SettingsSelect
        current={view.preferences.logSource}
        label="Source"
        onSelect={(logSource) => {
          void session.apply({ logSource });
        }}
        options={LOG_SOURCES.map((value) => ({
          label: value,
          value,
        }))}
        testID="log-source"
      />
      <SettingsCopy testID="open-runtime-logs" value={logLinesCopy(view.logs)} />
    </SettingsSection>
  );
}

export function ReportBugSettingsPanel({
  session,
}: {
  readonly session: SupportSettingsSession;
}) {
  const view = useSupportView(session);
  return (
    <SettingsSection testID="panel-report-bug" title="REPORT A BUG">
      <SettingsField
        label="What happened?"
        onChangeText={(reportDescription) => {
          void session.apply({ reportDescription });
        }}
        testID="report-description"
        value={view.preferences.reportDescription}
      />
      <SettingsSwitch
        checked={view.preferences.attachLogs}
        label="Attach redacted logs"
        onToggle={() => {
          void session.apply({ attachLogs: !view.preferences.attachLogs });
        }}
        testID="attach-logs"
      />
      <SettingsSwitch
        checked={view.preferences.attachProfile}
        label="Attach Capability Profile"
        onToggle={() => {
          void session.apply({ attachProfile: !view.preferences.attachProfile });
        }}
        testID="attach-profile"
      />
      <SettingsAction
        label="Build report"
        onPress={() => {
          void session.buildReport();
        }}
        testID="build-report"
      />
      <SettingsCopy testID="report-preview" value={view.reportPreview} />
      <SettingsAction
        label="Share"
        onPress={() => {
          void session.shareReport();
        }}
        testID="share-diagnostic-report"
      />
      {view.resultCopy ? (
        <SettingsCopy testID="report-result" value={view.resultCopy} />
      ) : null}
    </SettingsSection>
  );
}

export function AboutSettingsPanel({
  session,
}: {
  readonly session: SupportSettingsSession;
}) {
  const view = useSupportView(session);
  return (
    <SettingsSection testID="panel-about" title="ABOUT">
      <SettingsCopy
        testID="about-version"
        value={`StreamFusion Mobile ${view.installedVersion}`}
      />
      <SettingsCopy testID="open-source-licenses" value={view.licensesCopy} />
      <SettingsCopy testID="privacy" value={view.privacyCopy} />
      <MaintenanceActions session={session} view={view} />
    </SettingsSection>
  );
}

function MaintenanceActions({
  session,
  view,
}: {
  readonly session: SupportSettingsSession;
  readonly view: SupportSettingsView;
}) {
  return (
    <View>
      {MAINTENANCE_ACTIONS.map((action) => (
        <SettingsAction
          key={action.kind}
          label={action.label}
          onPress={() => {
            void session.requestMaintenance(action.kind);
          }}
          testID={action.kind}
        />
      ))}
      {view.pending ? (
        <View testID={`${view.pending}-confirmation`}>
          <SettingsCopy testID={`${view.pending}-copy`} value={view.pendingCopy} />
          <SettingsAction
            label="Cancel"
            onPress={() => {
              void session.cancelMaintenance();
            }}
            testID={`${view.pending}-cancel`}
          />
          <SettingsAction
            label="Confirm"
            onPress={() => {
              void session.confirmMaintenance();
            }}
            testID={`${view.pending}-confirm`}
          />
        </View>
      ) : null}
      {view.resultCopy ? (
        <SettingsCopy testID="maintenance-result" value={view.resultCopy} />
      ) : null}
    </View>
  );
}

function useSupportView(session: SupportSettingsSession): SupportSettingsView {
  const [view, setView] = useState<SupportSettingsView>(() =>
    session.peek(),
  );
  useEffect(() => {
    const unsubscribe = session.subscribe(() => {
      setView(session.peek());
    });
    void session.load().then(setView);
    return unsubscribe;
  }, [session]);
  return view;
}
