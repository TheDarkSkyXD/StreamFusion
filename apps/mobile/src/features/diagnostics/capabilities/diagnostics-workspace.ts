export const MOBILE_DIAGNOSTICS_TABS = [
  "overview",
  "resources",
  "io",
  "traces",
  "logs-reports",
  "developer-tools",
] as const;

export type MobileDiagnosticsTab = (typeof MOBILE_DIAGNOSTICS_TABS)[number];

export type DiagnosticsCollectionPhase =
  | "measuring"
  | "observed"
  | "unavailable";

export function isMobileDiagnosticsTab(
  value: unknown,
): value is MobileDiagnosticsTab {
  return (
    typeof value === "string" &&
    (MOBILE_DIAGNOSTICS_TABS as readonly string[]).includes(value)
  );
}
