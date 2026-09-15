import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  asMediaJobId,
  createQueuedMediaJobSnapshot,
  type MediaJobCommandName,
  type MediaJobSnapshot,
} from "@streamfusion/core/media-jobs";
import { toSerializedTimestamp } from "@streamfusion/core/activity";

import { MediaJobScreen } from "../components/media-job-screen";

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

const now = toSerializedTimestamp("2026-09-14T20:00:00.000Z");

function runningSnapshot(): MediaJobSnapshot {
  return {
    ...createQueuedMediaJobSnapshot({
      schemaVersion: 1,
      jobId: asMediaJobId("download-1"),
      kind: "download",
      sourceUri: "streamfusion-fixture://download",
      createdAt: now,
    }),
    phase: "running",
    progress: {
      transferredBytes: 4096,
      totalBytes: 65536,
      durationMs: 120,
    },
    artifact: {
      kind: "partial",
      relativePath: "media-jobs/download-1/artifact.bin",
      bytes: 4096,
    },
    service: { kind: "owned", notificationVisible: true },
    statusMessage: "Running",
  };
}

// Guards: missing Media Job stays distinct from a live job preview
// Guards: running jobs expose pause, cancel, finalize, recover, progress, and service ownership
// Guards: completed jobs expose Open, Export, and Delete
describe("Media Job screen", () => {
  it("renders a missing-job empty state", () => {
    const nodes = descendants(
      MediaJobScreen({
        onCommand: () => undefined,
        snapshot: null,
      }),
    );
    expect(byTestId(nodes, "media-job-missing")).toBeTruthy();
    expect(byTestId(nodes, "media-job-detail")).toBeUndefined();
  });

  it("renders running progress, artifact, service ownership, and valid commands", () => {
    const commands: MediaJobCommandName[] = [];
    const nodes = descendants(
      MediaJobScreen({
        onCommand: (command) => commands.push(command),
        snapshot: runningSnapshot(),
      }),
    );
    expect(byTestId(nodes, "media-job-detail")).toBeTruthy();
    expect(String(byTestId(nodes, "media-job-phase")?.props.children)).toContain(
      "Running",
    );
    expect(
      String(byTestId(nodes, "media-job-progress")?.props.children),
    ).toContain("6%");
    expect(
      String(byTestId(nodes, "media-job-artifact")?.props.children),
    ).toContain("Partial artifact");
    expect(
      String(byTestId(nodes, "media-job-service")?.props.children),
    ).toContain("Android service owns this job.");
    byTestId(nodes, "media-job-command-pause")?.props.onPress?.();
    expect(commands).toEqual(["pause"]);
    expect(byTestId(nodes, "media-job-command-cancel")).toBeTruthy();
    expect(byTestId(nodes, "media-job-command-finalize")).toBeTruthy();
    expect(byTestId(nodes, "media-job-command-recover")).toBeTruthy();
    expect(byTestId(nodes, "media-job-command-retry")).toBeUndefined();
  });

  it("offers Open, Export, and Delete on a completed artifact", () => {
    const actions: string[] = [];
    const snapshot: MediaJobSnapshot = {
      ...runningSnapshot(),
      phase: "completed",
      progress: {
        transferredBytes: 65536,
        totalBytes: 65536,
        durationMs: 120,
      },
      artifact: {
        kind: "complete",
        relativePath: "media-jobs/download-1/artifact.bin",
        bytes: 65536,
      },
      service: { kind: "unowned" },
      statusMessage: "Completed",
    };
    const nodes = descendants(
      MediaJobScreen({
        onCommand: () => undefined,
        onDelete: () => actions.push("delete"),
        onExport: () => actions.push("export"),
        onOpen: () => actions.push("open"),
        snapshot,
      }),
    );
    byTestId(nodes, "media-job-open")?.props.onPress?.();
    byTestId(nodes, "media-job-export")?.props.onPress?.();
    byTestId(nodes, "media-job-delete")?.props.onPress?.();
    expect(actions).toEqual(["open", "export", "delete"]);
  });
});
