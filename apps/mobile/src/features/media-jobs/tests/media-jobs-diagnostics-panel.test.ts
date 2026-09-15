import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  asMediaJobId,
  createQueuedMediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";

import { MediaJobsDiagnosticsPanel } from "../components/media-jobs-diagnostics-panel";

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

function byTestId(
  nodes: readonly Element[],
  testID: string,
): Element | undefined {
  return nodes.find((node) => node.props.testID === testID);
}

function press(nodes: readonly Element[], testID: string): void {
  byTestId(nodes, testID)?.props.onPress?.();
}

// Guards: Diagnostics can start download, HTTP range, network-loss, recording, compressed cutoff, and recover
describe("Media Jobs diagnostics panel", () => {
  it("starts fixture jobs, recovers, and opens an existing job", () => {
    const opened: string[] = [];
    const actions: string[] = [];
    const job = createQueuedMediaJobSnapshot({
      schemaVersion: 1,
      jobId: asMediaJobId("download-1"),
      kind: "download",
      sourceUri: "streamfusion-fixture://download",
      createdAt: toSerializedTimestamp("2026-09-14T20:00:00.000Z"),
    });
    const nodes = descendants(
      MediaJobsDiagnosticsPanel({
        jobs: [job],
        onOpenJob: (jobId) => opened.push(jobId),
        onRecover: () => actions.push("recover"),
        onStartDownload: () => actions.push("download"),
        onStartHttpRange: () => actions.push("range"),
        onStartNetworkLoss: () => actions.push("loss"),
        onStartRecording: () => actions.push("recording"),
        onStartCompressedRecording: () => actions.push("compressed"),
        onStartRecordingStoragePressure: () => actions.push("recording-pressure"),
        onStartStoragePressure: () => actions.push("pressure"),
      }),
    );
    expect(byTestId(nodes, "media-jobs-diagnostics")).toBeTruthy();
    press(nodes, "media-jobs-start-download");
    press(nodes, "media-jobs-start-http-range");
    press(nodes, "media-jobs-start-network-loss");
    press(nodes, "media-jobs-start-recording");
    press(nodes, "media-jobs-start-compressed-recording");
    press(nodes, "media-jobs-start-recording-storage-pressure");
    press(nodes, "media-jobs-start-storage-pressure");
    press(nodes, "media-jobs-recover");
    press(nodes, "media-jobs-open-download-1");
    expect(actions).toEqual([
      "download",
      "range",
      "loss",
      "recording",
      "compressed",
      "recording-pressure",
      "pressure",
      "recover",
    ]);
    expect(opened).toEqual(["download-1"]);
  });
});
