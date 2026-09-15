import {
  isMobileDiagnosticsTab,
  type DiagnosticsCollectionPhase,
  type MobileDiagnosticsTab,
} from "../capabilities/diagnostics-workspace";

export const DIAGNOSTICS_TAB_LABELS: Record<MobileDiagnosticsTab, string> = {
  overview: "Overview",
  resources: "Resources",
  io: "I/O",
  traces: "Traces",
  "logs-reports": "Logs and reports",
  "developer-tools": "Developer tools",
};

export const DIAGNOSTICS_REDACTION_COPY =
  "Reports exclude credentials, push tokens, relay secrets, and private provider content. This workspace does not inspect other apps or production logcat.";

const SECRET_PATTERNS = [
  /Bearer\s+\S+/gi,
  /access_token[=:"'\s]+\S+/gi,
  /refresh_token[=:"'\s]+\S+/gi,
  /fcm[-_]?token[=:"'\s]+\S+/gi,
  /oauth[_-]?token[=:"'\s]+\S+/gi,
  /session[_-]?cookie[=:"'\s]+\S+/gi,
];

export function parseDiagnosticsTab(
  value: unknown,
  current: MobileDiagnosticsTab,
): MobileDiagnosticsTab {
  return isMobileDiagnosticsTab(value) ? value : current;
}

function observationAgeCopy(observationAgeMs: number | null): string {
  if (observationAgeMs === null) {
    return "No observation age yet.";
  }
  return `Last observation ${Math.max(0, Math.round(observationAgeMs / 1000))}s ago.`;
}

export function diagnosticsObservationCopy(input: {
  readonly diagnosticIoWindow: string;
  readonly diagnosticWindow: string;
  readonly observationAgeMs: number | null;
}): string {
  return `Observation window ${input.diagnosticWindow}. I/O window ${input.diagnosticIoWindow}. ${observationAgeCopy(input.observationAgeMs)} App-owned resources only.`;
}

export function diagnosticsCollectionCopy(
  phase: DiagnosticsCollectionPhase,
  detail: string,
): string {
  switch (phase) {
    case "unavailable":
      return `Collection failed. ${detail} Retry stays on this device.`;
    case "measuring":
      return detail;
    case "observed":
      return `Collection is current. ${detail}`;
  }
}

export function redactDiagnosticExport(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]");
  }
  return redacted;
}
