import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock } from "../test-utils";

type DiagnosticsApi = ReturnType<typeof installElectronAPIMock>["diagnostics"];
type OpenLeaseRequest = Parameters<DiagnosticsApi["openLease"]>[0];

vi.mock("@/features/settings/data/diagnostics/renderer-diagnostics-reporter", () => ({
  startRendererDiagnosticsReporter: vi.fn(() => () => undefined),
}));

// Guards: React StrictMode lease probes must use distinct document identities so cleanup cannot close the active lease.
describe("useDiagnosticsWorkspace", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("opens each effect lifetime with a unique document instance", async () => {
    const api = installElectronAPIMock();
    const openLease = vi.fn(async (_request: OpenLeaseRequest) => ({
      kind: "error" as const,
      error: {
        code: "internal" as const,
        retry: { kind: "manual" as const },
        diagnosticId: crypto.randomUUID(),
      },
    }));
    api.diagnostics = {
      openLease,
      configureLease: vi.fn(),
      closeLease: vi.fn(),
      refresh: vi.fn(),
      reportRenderer: vi.fn(),
      onSnapshotChanged: vi.fn(() => () => undefined),
    };

    const { useDiagnosticsWorkspace } = await import("@/features/settings/data/use-diagnostics-workspace");
    renderHook(() => useDiagnosticsWorkspace({ tab: "overview", windowMinutes: 15 }), {
      reactStrictMode: true,
    });

    await waitFor(() => expect(openLease).toHaveBeenCalledTimes(2));
    const firstId = openLease.mock.calls.at(0)?.[0].documentInstanceId;
    const secondId = openLease.mock.calls.at(1)?.[0].documentInstanceId;

    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
  });
});
