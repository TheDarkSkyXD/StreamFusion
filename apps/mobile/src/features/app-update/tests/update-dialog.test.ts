import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { UpdateDialog } from "../components/update-dialog";
import { updatePresentation, type UpdateAction } from "../domain/update-presentation";

vi.mock("react-native", () => ({
  Modal: "Modal", Pressable: "Pressable", Text: "Text", View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));

const release = {
  tag: "android-v1", version: "1", apkBytes: 50_000_000, apkSha256: "a".repeat(64),
  notes: "", releaseUrl: "https://example.com/release",
};

type ElementProps = {
  readonly children?: ReactNode;
  readonly testID?: string;
  readonly onPress?: () => void;
  readonly onRequestClose?: () => void;
  readonly accessibilityRole?: string;
  readonly accessibilityValue?: { readonly now: number };
  readonly style?: unknown;
};

function findElement(node: ReactNode, testID: string): ElementProps | null {
  if (!isValidElement<ElementProps>(node)) return null;
  if (node.props.testID === testID) return node.props;
  for (const child of Children.toArray(node.props.children)) {
    const found = findElement(child, testID);
    if (found) return found;
  }
  return null;
}

function rootProps(node: ReactNode): ElementProps {
  if (!isValidElement<ElementProps>(node)) throw new Error("Expected dialog element");
  return node.props;
}

function findProgress(node: ReactNode): ElementProps | null {
  if (!isValidElement<ElementProps>(node)) return null;
  if (node.props.accessibilityRole === "progressbar") return node.props;
  for (const child of Children.toArray(node.props.children)) {
    const found = findProgress(child);
    if (found) return found;
  }
  return null;
}

describe("update dialog actions", () => {
  it("dispatches Yes, No, and offer request-close to the intended commands", () => {
    const model = updatePresentation({ kind: "idle" }, release);
    if (model?.kind !== "offer") throw new Error("Expected offer");
    const actions: UpdateAction[] = [];
    const dialog = UpdateDialog({ model, visible: true, onAction: (action) => actions.push(action) });
    expect(findElement(dialog, "update-action-download")?.style)
      .toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: "transparent" })]));
    findElement(dialog, "update-action-download")?.onPress?.();
    findElement(dialog, "update-action-later")?.onPress?.();
    rootProps(dialog).onRequestClose?.();
    expect(actions).toEqual(["download", "later", "later"]);
  });

  it("dispatches Cancel on download request-close and exposes measured progress", () => {
    const model = updatePresentation({ kind: "downloading", operation: "op", release, bytes: 12_500_000, total: 50_000_000 }, release);
    if (model?.kind !== "download") throw new Error("Expected download");
    const actions: UpdateAction[] = [];
    const dialog = UpdateDialog({ model, visible: true, onAction: (action) => actions.push(action) });
    expect(findElement(dialog, "update-progress")?.children).toBeTruthy();
    expect(findProgress(dialog)?.accessibilityValue?.now).toBe(25);
    rootProps(dialog).onRequestClose?.();
    findElement(dialog, "update-action-cancel")?.onPress?.();
    expect(actions).toEqual(["cancel", "cancel"]);
  });

});
