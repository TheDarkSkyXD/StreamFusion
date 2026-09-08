import { isValidElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { InstallationPolicyPanel } from "../components/installation-policy-panel";
import type { InstallationPolicyViewModel } from "../domain/installation-policy-runtime-controller";

vi.mock("react-native", () => ({
  Pressable: "Pressable",
  StyleSheet: { create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));

const ready: InstallationPolicyViewModel = {
  detail: "Ready.",
  installation: {
    detail: "Installation credential is registered.",
    generation: 1,
    phase: "registered",
    reconciledAt: "2026-09-07T00:00:00.000Z",
  },
  policy: {
    cacheAgeSeconds: 0,
    checkedAt: "2026-09-07T00:00:00.000Z",
    detail: "The signed capability policy is verified and effective.",
    effectiveSource: "fresh-verified",
    environment: "development",
    expiresAt: "2027-09-01T00:00:00.000Z",
    issuedAt: "2026-09-01T00:00:00.000Z",
    phase: "valid",
    reason: null,
    sequence: 1,
    verifiedAt: "2026-09-07T00:00:00.000Z",
  },
  refreshCapabilityPolicyEnabled: true,
  retryInstallationRegistrationEnabled: true,
};

type PanelElementProps = Readonly<{
  accessibilityState?: Readonly<{ busy?: boolean; disabled?: boolean }>;
  children?: unknown;
  testID?: string;
}>;

type PanelElement = ReactElement<PanelElementProps>;

function actions(model: InstallationPolicyViewModel) {
  const root = InstallationPolicyPanel({
    model,
    onRefreshCapabilityPolicy: () => undefined,
    onRetryInstallationRegistration: () => undefined,
  });
  return descendants(root).filter(
    (node) =>
      node.props?.testID === "retry-installation-registration" ||
      node.props?.testID === "refresh-capability-policy",
  );
}

function descendants(node: unknown): readonly PanelElement[] {
  if (!isValidElement<PanelElementProps>(node)) return [];
  const element: PanelElement = node;
  const children = element.props?.children;
  const childNodes = Array.isArray(children) ? children : [children];
  return [element, ...childNodes.flatMap((child) => descendants(child))];
}

describe("installation policy panel", () => {
  it("emits explicit ready, busy, then ready accessibility state for both actions", () => {
    const initial = actions(ready);
    expect(initial.map((action) => action.props.accessibilityState)).toEqual([
      { busy: false, disabled: false },
      { busy: false, disabled: false },
    ]);

    const checking = actions({
      ...ready,
      installation: { ...ready.installation, phase: "checking" },
      policy: { ...ready.policy, phase: "checking" },
      refreshCapabilityPolicyEnabled: false,
      retryInstallationRegistrationEnabled: false,
    });
    expect(checking.map((action) => action.props.accessibilityState)).toEqual([
      { busy: true, disabled: true },
      { busy: true, disabled: true },
    ]);

    expect(
      actions(ready).map((action) => action.props.accessibilityState),
    ).toEqual([
      { busy: false, disabled: false },
      { busy: false, disabled: false },
    ]);
  });
});
