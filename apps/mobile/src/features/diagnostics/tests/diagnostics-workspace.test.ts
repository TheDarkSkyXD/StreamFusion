import { describe, expect, it } from "vitest";

import {
  diagnosticsCollectionCopy,
  diagnosticsObservationCopy,
  parseDiagnosticsTab,
  redactDiagnosticExport,
} from "../domain/diagnostics-workspace";

// Guards: invalid Diagnostics tabs retain the current tab and exports stay redacted
describe("diagnostics workspace domain", () => {
  it("retains the current tab for invalid or desktop leftover values", () => {
    expect(parseDiagnosticsTab("traces", "overview")).toBe("traces");
    expect(parseDiagnosticsTab("processes", "overview")).toBe("overview");
    expect(parseDiagnosticsTab("failures", "io")).toBe("io");
    expect(parseDiagnosticsTab(undefined, "resources")).toBe("resources");
  });

  it("names observation windows and collection failure without claiming other-app inspection", () => {
    expect(
      diagnosticsObservationCopy({
        diagnosticIoWindow: "5m",
        diagnosticWindow: "30m",
        observationAgeMs: 4000,
      }),
    ).toContain("Observation window 30m");
    expect(
      diagnosticsCollectionCopy("unavailable", "Thermal sensor missing."),
    ).toBe(
      "Collection failed. Thermal sensor missing. Retry stays on this device.",
    );
  });

  it("redacts credentials, push tokens, and cookies from exported text", () => {
    const redacted = redactDiagnosticExport(
      [
        "Bearer abc.def",
        'access_token="twitch-secret"',
        "fcm_token=push-secret",
        "session_cookie=kick-session",
        "player stalled",
      ].join("\n"),
    );
    expect(redacted).toContain("[redacted]");
    expect(redacted).toContain("player stalled");
    expect(redacted).not.toContain("twitch-secret");
    expect(redacted).not.toContain("push-secret");
    expect(redacted).not.toContain("kick-session");
    expect(redacted).not.toContain("abc.def");
  });
});
