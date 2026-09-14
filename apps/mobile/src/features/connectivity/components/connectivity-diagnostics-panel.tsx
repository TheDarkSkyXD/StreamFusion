import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  ConnectivitySession,
  ConnectivityView,
} from "../capabilities/connectivity-session";

export function ConnectivityDiagnosticsPanel({
  session,
}: {
  readonly session: ConnectivitySession;
}) {
  const [view, setView] = useState<ConnectivityView | null>(null);
  useEffect(() => {
    void session.load().then(setView);
  }, [session]);
  return <ConnectivityDiagnosticsView view={view} />;
}

export function ConnectivityDiagnosticsView({
  view,
}: {
  readonly view: ConnectivityView | null;
}) {
  const proxy =
    view === null
      ? "Reading proxy state."
      : view.proxy.kind === "on"
        ? `Proxy ${view.proxy.host}:${view.proxy.port}`
        : "Proxy off";
  const native =
    view === null
      ? ""
      : view.nativeProxy === "ready"
        ? "Native proxy ready."
        : "Native proxy unavailable. StreamFusion Development is required.";
  return (
    <View style={styles.panel} testID="panel-connectivity-diagnostics">
      <Text selectable style={styles.label}>
        CONNECTIVITY
      </Text>
      <Text selectable style={styles.title} testID="diagnostics-network-status">
        {view?.network === "offline" ? "Offline" : "Online"}
      </Text>
      <Text selectable style={styles.detail} testID="diagnostics-network-detail">
        {view?.networkDetail ?? "Reading network status."}
      </Text>
      <Text selectable style={styles.detail} testID="diagnostics-proxy-status">
        {proxy}
      </Text>
      {native ? (
        <Text selectable style={styles.detail} testID="diagnostics-proxy-native">
          {native}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  label: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 24,
  },
  detail: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
});
