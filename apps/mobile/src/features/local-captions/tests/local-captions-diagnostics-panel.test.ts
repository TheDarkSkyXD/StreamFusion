import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocalCaptionsDiagnosticsPanel } from "../components/local-captions-diagnostics-panel";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

type ElementProps = Readonly<{
  children?: unknown;
  onPress?: () => void;
  testID?: string;
}>;
type Element = ReactElement<ElementProps>;

function descendants(node: unknown): readonly Element[] {
  if (Array.isArray(node)) return node.flatMap((child) => descendants(child));
  if (!isValidElement<ElementProps>(node)) return [];
  const element: Element = node;
  const candidate = element.type as unknown;
  const component =
    typeof candidate === "function"
      ? (candidate as (props: ElementProps) => unknown)
      : null;
  if (component) return [element, ...descendants(component(element.props))];
  const children = element.props.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

function byTestId(nodes: readonly Element[], testID: string): Element | undefined {
  return nodes.find((node) => node.props.testID === testID);
}

function press(nodes: readonly Element[], testID: string): void {
  byTestId(nodes, testID)?.props.onPress?.();
}

// Guards: Diagnostics can install the fixture pack, start one session, reject a second, and prove no upload
describe("Local captions diagnostics panel", () => {
  it("stamps contract 2 and starts fixture caption work", () => {
    const actions: string[] = [];
    const nodes = descendants(
      LocalCaptionsDiagnosticsPanel({
        model: {
          busy: false,
          cueText: "Local captions are running on this device.",
          model: {
            audioUploadAttempts: 0,
            displaySize: "43.11 MiB",
            downloadedBytes: 45_202_074,
            expectedBytes: 45_202_074,
            installed: true,
            languageLabel: "English",
            license: "Apache-2.0",
            modelId: "english-v1",
            pack: "fixture",
            phase: "ready",
            sha256Verified: true,
            statusMessage:
              "English model ready offline. 43.11 MiB. Audio stays on this device.",
          },
          proof: {
            audioLeftDevice: false,
            audioUploadAttempts: 0,
            cueText: "Local captions are running on this device.",
            displaySize: "43.11 MiB",
            downloadedBytes: 45_202_074,
            expectedBytes: 45_202_074,
            installed: true,
            languageLabel: "English",
            license: "Apache-2.0",
            microphonePermissionRequested: false,
            modelId: "english-v1",
            pack: "fixture",
            pcmBytesProcessed: 1280,
            phase: "ready",
            sessionId: "cap-fixture-diagnostics",
            sha256Verified: true,
            state: "active",
            statusMessage:
              "English model ready offline. 43.11 MiB. Audio stays on this device.",
          },
          session: {
            audioLeftDevice: false,
            audioUploadAttempts: 0,
            cueText: "Local captions are running on this device.",
            microphonePermissionRequested: false,
            pcmBytesProcessed: 1280,
            sessionId: "cap-fixture-diagnostics",
            state: "active",
          },
          status: "English model ready offline. 43.11 MiB. Audio stays on this device.",
        },
        onClearConstraint: () => actions.push("clear"),
        onInstallFixture: () => actions.push("install"),
        onInstallIntegrityFail: () => actions.push("integrity"),
        onQueueConstraint: () => actions.push("queue"),
        onRemove: () => actions.push("remove"),
        onStartConstrained: () => actions.push("constrained"),
        onStartFixture: () => actions.push("fixture"),
        onStartSecond: () => actions.push("second"),
        onStop: () => actions.push("stop"),
      }),
    );
    expect(byTestId(nodes, "local-captions-build-stamp")?.props.children).toBe(
      "M04 Captions · contract 2",
    );
    expect(byTestId(nodes, "local-captions-proof")?.props.children).toContain(
      "uploads 0",
    );
    expect(byTestId(nodes, "local-captions-proof")?.props.children).toContain(
      "mic not requested",
    );
    press(nodes, "local-captions-install-fixture");
    press(nodes, "local-captions-start-fixture");
    press(nodes, "local-captions-start-second");
    press(nodes, "local-captions-install-integrity-fail");
    press(nodes, "local-captions-start-constrained");
    expect(actions).toEqual([
      "install",
      "fixture",
      "second",
      "integrity",
      "constrained",
    ]);
  });
});
