import { describe, expect, it } from "vitest";

import {
  DiagnosticsObservability,
  safeDiagnosticText,
} from "@backend/diagnostics/diagnostics-observability";

// Guards: diagnostic observations redact credentials, URL queries, and absolute user paths before retention.
// Guards: logical I/O, spans, logs, and stable failure groups remain distinct canonical observations.
// Guards: high-volume informational logs cannot evict recent error evidence from failure diagnostics.
describe("DiagnosticsObservability", () => {
  it("redacts sensitive text before it reaches retained logs and spans", async () => {
    const observability = new DiagnosticsObservability();
    observability.recordLog({
      level: "error",
      source: "Bearer secret-token",
      message:
        "access_token=secret-token https://example.test/path?token=secret C:\\Users\\Alice\\private.txt",
      observedAtMs: 1_000,
    });

    await expect(
      observability.runSpan("request", async () => {
        throw new Error("password=hunter2 at https://example.test/private?key=secret");
      })
    ).rejects.toThrow("password=hunter2");

    const snapshot = observability.snapshot(0);
    expect(JSON.stringify(snapshot)).not.toContain("secret-token");
    expect(JSON.stringify(snapshot)).not.toContain("hunter2");
    expect(JSON.stringify(snapshot)).not.toContain("Alice");
    expect(snapshot.logs[0]?.message).toContain("https://example.test/path");
    expect(snapshot.logs[0]?.message).not.toContain("?token=");
  });

  it("aggregates logical I/O and groups repeated failures by a stable fingerprint", () => {
    const observability = new DiagnosticsObservability();
    observability.recordIo({
      component: "main-log",
      operation: "append",
      logicalWriteBytes: 120,
      durationMs: 2,
    });
    observability.recordIo({
      component: "main-log",
      operation: "append",
      logicalWriteBytes: 80,
      durationMs: 3,
    });
    observability.recordLog({
      level: "error",
      source: "Network",
      message: "Request 123 failed",
      observedAtMs: 2_000,
    });
    observability.recordLog({
      level: "error",
      source: "Network",
      message: "Request 456 failed",
      observedAtMs: 3_000,
    });

    const snapshot = observability.snapshot(0);
    expect(snapshot.io).toEqual([
      {
        component: "main-log",
        operation: "append",
        logicalReadBytes: 0,
        logicalWriteBytes: 200,
        count: 2,
        durationMs: 5,
      },
    ]);
    expect(snapshot.commonFailures).toHaveLength(1);
    expect(snapshot.commonFailures[0]?.count).toBe(2);
  });

  it("removes URL query and fragment data from standalone safe text", () => {
    expect(safeDiagnosticText("GET https://status.test/path?q=secret#private")).toBe(
      "GET https://status.test/path"
    );
  });

  it("retains error evidence when informational logs overflow the trace-log buffer", () => {
    const observability = new DiagnosticsObservability();
    observability.recordLog({
      level: "error",
      source: "Kick:Client",
      message: "Request failed",
      observedAtMs: 1_000,
    });

    for (let index = 0; index < 2_100; index += 1) {
      observability.recordLog({
        level: "info",
        source: "FollowRepair",
        message: `Updated channel ${index}`,
        observedAtMs: 2_000 + index,
      });
    }

    const snapshot = observability.snapshot(0);
    expect(snapshot.logs.some((log) => log.level === "error")).toBe(false);
    expect(snapshot.latestFailures).toEqual([
      expect.objectContaining({ source: "Kick:Client", cause: "Request failed", count: 1 }),
    ]);
  });
});
