import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticsWorkspace } from "../components/diagnostics-workspace";
import { DIAGNOSTICS_TAB_LABELS } from "../domain/diagnostics-workspace";
import { MOBILE_DIAGNOSTICS_TABS } from "../capabilities/diagnostics-workspace";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

const WORKSPACE_SLOTS = {
  overview: "overview-slot",
  resources: "resources-slot",
  io: "io-slot",
  traces: "traces-slot",
  "logs-reports": "logs-slot",
  "developer-tools": "dev-slot",
} as const;

function childProps(node: unknown): Record<string, unknown> {
  if (!isValidElement(node)) {
    throw new Error("expected element");
  }
  return node.props as Record<string, unknown>;
}

function flatten(node: unknown): unknown[] {
  if (!isValidElement(node)) return [];
  if (typeof node.type === "function") {
    return flatten((node.type as (props: object) => unknown)(node.props));
  }
  const children = Array.isArray(childProps(node).children)
    ? childProps(node).children
    : [childProps(node).children];
  return children.flatMap((child: unknown) =>
    isValidElement(child) ? [child, ...flatten(child)] : [],
  );
}

function tabNodes(tree: unknown): unknown[] {
  return flatten(tree).filter(
    (node) =>
      isValidElement(node) &&
      String(childProps(node).testID ?? "").startsWith("diagnostics-tab-"),
  );
}

// Guards: Diagnostics exposes six distinct tabs with selected accessibility state
describe("DiagnosticsWorkspace", () => {
  it("renders six tabs and only the selected slot", () => {
    const element = DiagnosticsWorkspace({
      collectionCopy: "Collection is current.",
      observationCopy: "Observation window 5m.",
      onRunCheck: () => undefined,
      onSelectTab: () => undefined,
      selectedTab: "io",
      slots: WORKSPACE_SLOTS,
    });
    const tabs = tabNodes(element);
    expect(tabs).toHaveLength(MOBILE_DIAGNOSTICS_TABS.length);
    expect(tabs.map((tab) => childProps(tab).testID)).toEqual(
      MOBILE_DIAGNOSTICS_TABS.map((tab) => `diagnostics-tab-${tab}`),
    );
    const selected = tabs.find(
      (tab) => childProps(tab).testID === "diagnostics-tab-io",
    );
    expect(childProps(selected).accessibilityRole).toBe("tab");
    expect(childProps(selected).accessibilityState).toEqual({ selected: true });
    expect(childProps(selected).accessibilityLabel).toBe(
      DIAGNOSTICS_TAB_LABELS.io,
    );
    const serialized = JSON.stringify(element);
    expect(serialized).toContain("io-slot");
    expect(serialized).not.toContain("overview-slot");
    expect(serialized).not.toContain("dev-slot");
  });
});
