import { useEffect, useState } from "react";
import { View } from "react-native";

import {
  DIAGNOSTIC_WINDOWS,
  LOG_LEVELS,
  LOG_SOURCES,
  type SupportSettingsSession,
  type SupportSettingsView,
} from "../capabilities/support-settings";
import { defaultSupportSettingsView } from "../domain/support-settings";
import {
  SettingsAction,
  SettingsChoiceRow,
  SettingsCopy,
  SettingsField,
  SettingsSection,
  SettingsSwitch,
} from "./settings-controls";

const MAINTENANCE_ACTIONS = [
  { kind: "clear-history", label: "Clear history" },
  { kind: "remove-media", label: "Remove media" },
  { kind: "disconnect-accounts", label: "Disconnect accounts" },
  { kind: "reset-app", label: "Reset the app" },
] as const;

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
  return (
    <SettingsSection testID="panel-updates" title="UPDATES">
      <SettingsCopy
        testID="update-status"
        value={`Installed ${view.installedVersion}. ${view.updateCopy}`}
      />
      <SettingsCopy
        testID="automatic-foreground-update-checks-copy"
        value={view.deniedCopy}
      />
      <SettingsSwitch
        checked={view.preferences.automaticForegroundUpdateChecks}
        label="Check automatically while foregrounded"
        onToggle={() => {
          void session.apply({
            automaticForegroundUpdateChecks:
              !view.preferences.automaticForegroundUpdateChecks,
          });
        }}
        testID="automatic-foreground-update-checks"
      />
      <SettingsAction
        label="Check now"
        onPress={() => {
          void session.checkForUpdates();
        }}
        testID="check-for-updates"
      />
    </SettingsSection>
  );
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
      <SettingsChoiceRow
        current={view.preferences.diagnosticWindow}
        label="Observation window"
        onSelect={(diagnosticWindow) => {
          void session.apply({ diagnosticWindow });
        }}
        options={DIAGNOSTIC_WINDOWS}
        testID="diagnostic-window"
      />
      <SettingsChoiceRow
        current={view.preferences.diagnosticIoWindow}
        label="I/O observation window"
        onSelect={(diagnosticIoWindow) => {
          void session.apply({ diagnosticIoWindow });
        }}
        options={DIAGNOSTIC_WINDOWS}
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
      <SettingsChoiceRow
        current={view.preferences.logLevel}
        label="Minimum level"
        onSelect={(logLevel) => {
          void session.apply({ logLevel });
        }}
        options={LOG_LEVELS}
        testID="log-level"
      />
      <SettingsChoiceRow
        current={view.preferences.logSource}
        label="Source"
        onSelect={(logSource) => {
          void session.apply({ logSource });
        }}
        options={LOG_SOURCES}
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
    defaultSupportSettingsView(),
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
